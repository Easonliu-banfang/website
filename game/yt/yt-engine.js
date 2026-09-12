/* 顶哪个羊（羊顶羊）规则引擎 —— 纯逻辑，Worker（服务端权威）与前端（插值渲染/AI）共用
 *
 * 场地：4 条横向赛道，左（slot 0）右（slot 1）各占一侧，各 100 点血量。
 * 羊：4 档力气 1-4（小羊/中羊/大羊/巨羊）。
 *   · 同赛道两方羊相遇：力气大者留下，小者被顶掉；同级双双消失。
 *   · 羊推进到对方基地：对方扣血 = 羊的等级。
 * 冷却：放羊后该赛道冷却（等级越高冷却越久），冷却中不能在同赛道再放。
 * 手牌：开局 3 只，每 1.5 秒自动补 1 只（上限 6），等级按权重随机。
 *
 * 时间模型（无需定时器）：
 *   state.simAt = 已模拟到的时刻；pos 由「出生时间 + 速度」推导。
 *   simulate(state, now) 以 50ms 步长推进，处理补牌 / 前进 / 碰撞 / 得分。
 *   前端用 pos + (Date.now()-simAt)/1000*SPEED 插值到当前时刻（平滑动画）。
 */
(function (global) {
  'use strict';

  var LANES = 4;
  var LEN = 100;             // 赛道长度（虚拟单位）
  var SPEED = 13;            // 羊前进速度（单位/秒）→ 约 7.7 秒走完全程
  var STEP_MS = 50;          // 模拟步长
  var MAX_HP = 100;
  var HAND_MAX = 6;
  var HAND_START = 3;
  var DRAW_INTERVAL = 1500;  // 每 1.5 秒补一只
  var COOL_MS = [0, 5000, 8000, 11000, 15000];   // 冷却（按等级）：小羊 5s → 巨羊 15s（长冷却，强调策略取舍）
  var WEIGHT = [0, 0.40, 0.30, 0.20, 0.10];    // 等级出现权重：1..4

  function pickLevel(rng) {
    var r = rng();
    var acc = 0;
    for (var lv = 1; lv <= 4; lv++) { acc += WEIGHT[lv]; if (r < acc) return lv; }
    return 1;
  }

  function createState(lanes) {
    return {
      lanes: lanes || LANES,
      hp: [MAX_HP, MAX_HP],
      sheep: [],              // {id, slot, lane, lv, pos}
      hands: [[], []],
      cool: [[0, 0, 0, 0], [0, 0, 0, 0]],   // 每条赛道可再次放羊的时刻（绝对时间）
      nextDraw: [0, 0],
      simAt: 0,
      idSeq: 1,
      winner: -1,
      started: false,
    };
  }

  function nowMs() { return (typeof Date !== 'undefined') ? Date.now() : 0; }

  function sortHand(hand) { return hand.slice().sort(function (a, b) { return a - b; }); }

  // 开始：设置初始手牌与模拟起点（服务端开局调用）
  function start(state, now, rng) {
    now = now || nowMs();
    rng = rng || Math.random;
    state.started = true;
    state.simAt = now;
    state.nextDraw = [now + DRAW_INTERVAL, now + DRAW_INTERVAL];
    state.hands = [[], []];
    for (var s = 0; s < 2; s++) {
      for (var i = 0; i < HAND_START; i++) state.hands[s].push(pickLevel(rng));
    }
    return state;
  }

  /* 推进模拟到 now（幂等；多次调用等价于一次大步） */
  function simulate(state, now) {
    if (state.winner >= 0) { state.simAt = now; return { events: [] }; }
    var events = [];
    if (!state.simAt) state.simAt = now;
    var guard = 0;
    while (state.simAt < now && guard++ < 20000) {
      var remain = now - state.simAt;
      var dtMs = Math.min(STEP_MS, remain);
      var dt = dtMs / 1000;
      state.simAt += dtMs;
      var t = state.simAt;

      // 1) 补牌
      for (var s = 0; s < 2; s++) {
        while (state.hands[s].length < HAND_MAX && t >= state.nextDraw[s]) {
          state.hands[s].push(pickLevel(Math.random));
          state.nextDraw[s] += DRAW_INTERVAL;
          events.push({ t: 'draw', slot: s });
        }
        if (t < state.nextDraw[s] && state.hands[s].length >= HAND_MAX) {
          // 满手牌时把补牌时间跟到当前（避免瞬间连补）
          state.nextDraw[s] = Math.max(state.nextDraw[s], t + DRAW_INTERVAL);
        }
      }

      // 2) 前进 + 到达判定（记录 prev 供碰撞穿越检测）
      var alive = [];
      for (var i = 0; i < state.sheep.length; i++) {
        var sh = state.sheep[i];
        sh.prev = sh.pos;
        sh.pos += SPEED * dt;
        if (sh.pos >= LEN) {
          var foe = 1 - sh.slot;
          state.hp[foe] -= sh.lv;
          events.push({ t: 'goal', slot: sh.slot, lv: sh.lv, lane: sh.lane, hp: state.hp[foe] });
          if (state.hp[foe] <= 0) {
            state.hp[foe] = Math.max(0, state.hp[foe]);
            state.winner = sh.slot;
            events.push({ t: 'win', slot: sh.slot });
          }
          continue;   // 该羊消失
        }
        alive.push(sh);
      }
      state.sheep = alive;
      if (state.winner >= 0) break;

      // 3) 同赛道异方相撞（相遇条件：双方进度之和达到赛道长度，即位置重合/交叉）
      //    slot0 羊位置 = pos（左→右），slot1 羊位置 = LEN - pos（右→左）
      //    两羊相遇 ⇔ pos0 + pos1 >= LEN；穿越 ⇔ 上一帧和 < LEN 且本帧 >= LEN
      var byLane = {};
      for (var j = 0; j < state.sheep.length; j++) {
        var sj = state.sheep[j];
        (byLane[sj.lane] = byLane[sj.lane] || []).push(sj);
      }
      var dead = {};
      Object.keys(byLane).forEach(function (lane) {
        var arr = byLane[lane];
        var left = arr.filter(function (x) { return x.slot === 0; });
        var right = arr.filter(function (x) { return x.slot === 1; });
        left.forEach(function (a) {
          right.forEach(function (b) {
            if (dead[a.id] || dead[b.id]) return;
            var before = (a.prev !== undefined ? a.prev : a.pos) + (b.prev !== undefined ? b.prev : b.pos);
            var now = a.pos + b.pos;
            if (!(before < LEN && now >= LEN)) return;      // 非本步穿越
            if (a.lv > b.lv) { dead[b.id] = true; events.push({ t: 'clash', lane: Number(lane), win: a.id, lose: b.id }); }
            else if (b.lv > a.lv) { dead[a.id] = true; events.push({ t: 'clash', lane: Number(lane), win: b.id, lose: a.id }); }
            else { dead[a.id] = true; dead[b.id] = true; events.push({ t: 'clash', lane: Number(lane), both: true }); }
          });
        });
      });
      if (Object.keys(dead).length) {
        state.sheep = state.sheep.filter(function (sh) { return !dead[sh.id]; });
      }
    }
    if (state.simAt < now) state.simAt = now;
    return { events: events };
  }

  /* 放羊：把手里等级 lv 的羊放到赛道 lane */
  function deploy(state, slot, lv, lane, now) {
    now = now || nowMs();
    if (state.winner >= 0) return { ok: false, error: '对局已结束' };
    if (slot !== 0 && slot !== 1) return { ok: false, error: '座位无效' };
    if (lane < 0 || lane >= state.lanes) return { ok: false, error: '赛道无效' };
    if (lv < 1 || lv > 4) return { ok: false, error: '羊等级无效' };
    simulate(state, now);
    if (now < state.cool[slot][lane]) {
      return { ok: false, error: '该赛道冷却中', coolLeft: Math.ceil((state.cool[slot][lane] - now) / 100) / 10 };
    }
    var idx = state.hands[slot].indexOf(lv);
    if (idx < 0) return { ok: false, error: '手里没有这只羊' };
    state.hands[slot].splice(idx, 1);
    state.cool[slot][lane] = now + COOL_MS[lv];
    state.sheep.push({
      id: state.idSeq++,
      slot: slot, lane: lane, lv: lv,
      pos: 3,                       // 从自己基地前沿出发（3% 处）
      born: now,
    });
    return { ok: true };
  }

  /* 视图裁剪：只给本人手牌；场上羊与血量公开 */
  function viewFor(state, slot, now) {
    now = now || nowMs();
    return {
      you: slot,
      lanes: state.lanes,
      hp: state.hp.slice(),
      sheep: state.sheep.map(function (sh) {
        return { id: sh.id, slot: sh.slot, lane: sh.lane, lv: sh.lv, pos: Math.round(sh.pos * 10) / 10 };
      }),
      hand: sortHand(state.hands[slot] || []),
      handCount: [state.hands[0].length, state.hands[1].length],
      cool: [state.cool[0].slice(), state.cool[1].slice()],
      nextDraw: state.nextDraw.slice(),
      simAt: state.simAt,
      now: now,
      winner: state.winner,
      started: state.started,
    };
  }

  // 供 AI/前端使用
  function coolMs(lv) { return COOL_MS[lv] || 0; }

  global.YT = {
    LANES: LANES, LEN: LEN, SPEED: SPEED, MAX_HP: MAX_HP, HAND_MAX: HAND_MAX, DRAW_INTERVAL: DRAW_INTERVAL,
    createState: createState, start: start, simulate: simulate, deploy: deploy, viewFor: viewFor,
    pickLevel: pickLevel, coolMs: coolMs, sortHand: sortHand,
  };
})(typeof window !== 'undefined' ? window : globalThis);
