/* 顶哪个羊（羊顶羊）规则引擎 —— 纯逻辑，Worker（服务端权威）与前端（插值渲染/AI）共用
 *
 * 场地：5 条横向赛道，左（slot 0）右（slot 1）各占一侧，各 100 点血量。
 * 羊：4 档重量 10/30/60/80 KG（内部用 lv 1-4 表示档位；小/中/大/巨）。
 *   · 同赛道两方羊相遇：不直接抵消——重量大的推着小的走（推挤）。
 *     推挤速度 ∝ 重量差：中羊(30) 推小羊(10) 慢速推挤；三只大羊(180) 推小羊(10) 快速推进。
 *   · 双方重量相同：僵持顶住，谁都推不动谁（不消失）。
 *   · 弱方被一路推回自家基地 → 消失（被顶回老家，不扣血）；强方继续推进得分。
 *   · 羊推进到对方基地：对方扣血按原版规则 —— 越轻的羊偷家伤害越大：
 *     10KG 小羊扣 12、30KG 扣 8、60KG 扣 4、80KG 巨羊只扣 2。
 * 冷却：按「羊」冷却 —— 放出一只某档的羊后，该档进入冷却（与赛道无关），
 *       冷却期间不能再放同档的羊；档位越高冷却越久。
 * 手牌：开局 3 只，每 1.5 秒自动补 1 只（上限 6），档位按权重随机。
 *
 * 时间模型（无需定时器）：
 *   state.simAt = 已模拟到的时刻；pos 由「出生时间 + 速度」推导。
 *   simulate(state, now) 以 50ms 步长推进，处理补牌 / 前进 / 推挤碰撞 / 得分。
 *   前端用 pos + (Date.now()-simAt)/1000*spd 插值到当前时刻（平滑动画）；
 *   推挤中的羊 spd 可能为负（后退），插值方向随之反转。
 */
(function (global) {
  'use strict';

  var LANES = 5;             // 5 条赛道（规则允许 3-5 条；更多并行通道 → 突破更可能）
  var LEN = 100;             // 赛道长度（虚拟单位）
  var SPEED = 13;            // 羊自由前进速度（单位/秒）→ 约 7.7 秒走完全程
  var BORN_POS = 3;          // 出生位置（自家基地前沿）
  var RETURN_POS = 3;        // 被推回该位置以下 → 判定「被顶回老家」消失
  var STEP_MS = 50;          // 模拟步长
  var MAX_HP = 100;
  var HAND_MAX = 6;
  var HAND_START = 3;
  var DRAW_INTERVAL = 1500;  // 每 1.5 秒补一只
  var COOL_MS = [0, 5000, 8000, 11000, 15000];   // 冷却（按档位）：小羊 5s → 巨羊 15s（长冷却，强调策略取舍）
  var WEIGHT = [0, 0.40, 0.30, 0.20, 0.10];    // 档位出现权重：1..4（10/30/60/80KG）
  var KG = [0, 10, 30, 60, 80];                 // 档位 → 重量（KG）
  var DMG = [0, 12, 8, 4, 2];                   // 到达对方基地扣血（原版规则：越轻扣越多）

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
      sheep: [],              // {id, slot, lane, lv, pos, prev, spd}
      hands: [[], []],
      cool: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],   // 按等级的冷却：cool[slot][lv] = 可再放该等级羊的时刻
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

  /* 推挤（每 lane）：只对「前沿接触羊」正面僵持/推挤，后排羊自由前进不受影响。
 * 接触模型：相遇(交叉)后前沿对保持「恰好接触」(pos0+pos1 === LEN)，
 * 弱侧被顶后退 v*dt，强侧跟进贴住（不重叠、不分离），按力量差推进。 */
  function resolvePush(laneArr, dt, events, laneNo) {
    var left = [], right = [];
    for (var i = 0; i < laneArr.length; i++) {
      var sh = laneArr[i];
      if (sh.slot === 0) left.push(sh); else right.push(sh);
    }
    if (!left.length || !right.length) return;      // 单边无羊 → 自由行

    // 前沿羊（各自 pos 最大者）是否相遇 / 已交叉
    var aL = left[0], bR = right[0];
    for (var j = 1; j < left.length; j++) if (left[j].pos > aL.pos) aL = left[j];
    for (var k = 1; k < right.length; k++) if (right[k].pos > bR.pos) bR = right[k];

    if (aL.pos + bR.pos < LEN) return;              // 尚未相遇

    // 力量按该赛道全体羊合计（前沿接触 + 可能的后排增援）
    var Lpow = 0, Rpow = 0;
    for (var m = 0; m < left.length; m++) Lpow += left[m].lv;
    for (var n = 0; n < right.length; n++) Rpow += right[n].lv;

    if (Lpow === Rpow) {
      // 僵持：前沿对静止在相遇处（对齐到恰好接触），后排继续自由前进，
      // 增援力量并入后可打破僵持——不会出现「后排还没碰到就停下」。
      // 首次相遇时 prev 和 < LEN：两羊各走一半到达接触点
      var reach = (LEN - (aL.prev + bR.prev)) / 2;
      if (reach > 0 && reach <  1.4) {
        aL.pos = aL.prev + reach;
        bR.pos = bR.prev + reach;
      } else {
        aL.pos = aL.prev; bR.pos = bR.prev;
      }
      aL.spd = 0; bR.spd = 0;
      events.push({ t: 'clash', lane: laneNo, stall: true });
      return;
    }
    if (Lpow > Rpow) {
      // 左推右（左强）：弱侧被顶后退 v*dt，强侧跟进保持接触 (sum === LEN)
      var v = SPEED * (Lpow - Rpow) / Lpow;
      bR.pos = bR.prev - v * dt;          // 右羊被顶回自家基地方向
      aL.pos = LEN - bR.pos;              // 左羊贴住右羊（sum 恒 = LEN）
      aL.spd = v; bR.spd = -v;
      events.push({ t: 'clash', lane: laneNo, winSide: 0, push: true });
      return;
    }
    // 右推左（右强）
    var w = SPEED * (Rpow - Lpow) / Rpow;
    aL.pos = aL.prev - w * dt;            // 左羊被顶回
    bR.pos = LEN - aL.pos;                // 右羊贴住（sum 恒 = LEN）
    aL.spd = -w; bR.spd = w;
    events.push({ t: 'clash', lane: laneNo, winSide: 1, push: true });
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

      // 2) 前进（默认全速推进；推挤会覆写为推挤速度）
      for (var i = 0; i < state.sheep.length; i++) {
        var sh = state.sheep[i];
        sh.prev = sh.pos;
        sh.spd = SPEED;
        sh.pos += SPEED * dt;
      }

      // 3) 同赛道异方相遇 → 推挤（按赛道分组，全体羊一并处理）
      var byLane = {};
      for (var j = 0; j < state.sheep.length; j++) {
        var sj = state.sheep[j];
        (byLane[sj.lane] = byLane[sj.lane] || []).push(sj);
      }
      var laneNos = Object.keys(byLane);
      for (var li = 0; li < laneNos.length; li++) {
        resolvePush(byLane[laneNos[li]], dt, events, Number(laneNos[li]));
      }

      // 4) 到达判定 / 被顶回老家判定
      var alive = [];
      for (var i2 = 0; i2 < state.sheep.length; i2++) {
        var sh2 = state.sheep[i2];
        if (sh2.pos >= LEN) {
          var foe = 1 - sh2.slot;
          state.hp[foe] -= DMG[sh2.lv];
          events.push({ t: 'goal', slot: sh2.slot, lv: sh2.lv, lane: sh2.lane, hp: state.hp[foe] });
          if (state.hp[foe] <= 0) {
            state.hp[foe] = Math.max(0, state.hp[foe]);
            state.winner = sh2.slot;
            events.push({ t: 'win', slot: sh2.slot });
          }
          continue;   // 该羊得分后消失
        }
        if (sh2.pos <= RETURN_POS && sh2.prev > sh2.pos) {
          // 被一路推回自家基地 → 被顶回老家（不扣血）
          events.push({ t: 'retreat', slot: sh2.slot, lv: sh2.lv, lane: sh2.lane });
          continue;   // 该羊消失
        }
        alive.push(sh2);
      }
      state.sheep = alive;
      if (state.winner >= 0) break;
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
    var readyAt = state.cool[slot][lv] || 0;
    if (now < readyAt) {
      return { ok: false, error: lv + ' 力羊冷却中', coolLeft: Math.ceil((readyAt - now) / 100) / 10 };
    }
    var idx = state.hands[slot].indexOf(lv);
    if (idx < 0) return { ok: false, error: '手里没有这只羊' };
    // 该赛道该侧已有羊在途（未被顶回/未得分）→ 不能再放
    for (var t = 0; t < state.sheep.length; t++) {
      var ex = state.sheep[t];
      if (ex.slot === slot && ex.lane === lane) {
        return { ok: false, error: '该赛道已有羊在推进，战罢才能再放', busyLane: lane };
      }
    }
    state.hands[slot].splice(idx, 1);
    state.cool[slot][lv] = now + COOL_MS[lv];     // 该等级羊进入冷却（与赛道无关）
    state.sheep.push({
      id: state.idSeq++,
      slot: slot, lane: lane, lv: lv,
      pos: BORN_POS,                 // 从自己基地前沿出发
      prev: BORN_POS,                // 上一帧位置初始 = 出生位置
      spd: SPEED,
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
        return { id: sh.id, slot: sh.slot, lane: sh.lane, lv: sh.lv, kg: KG[sh.lv] || 0, pos: Math.round(sh.pos * 10) / 10, spd: Math.round(sh.spd * 10) / 10 };
      }),
      hand: sortHand(state.hands[slot] || []),
      handCount: [state.hands[0].length, state.hands[1].length],
      cool: [state.cool[0].slice(), state.cool[1].slice()],   // 按等级：cool[slot][lv]
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
    LANES: LANES, LEN: LEN, SPEED: SPEED, BORN_POS: BORN_POS, RETURN_POS: RETURN_POS,
    KG: KG, DMG: DMG,
    MAX_HP: MAX_HP, HAND_MAX: HAND_MAX, DRAW_INTERVAL: DRAW_INTERVAL,
    createState: createState, start: start, simulate: simulate, deploy: deploy, viewFor: viewFor,
    pickLevel: pickLevel, coolMs: coolMs, sortHand: sortHand,
  };
})(typeof window !== 'undefined' ? window : globalThis);