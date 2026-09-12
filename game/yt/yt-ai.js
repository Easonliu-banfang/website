/* 顶哪个羊 AI（供 BotDriver 代打 / 本地 AI 模式）
 * 策略：① 对手羊逼近我方基地 → 放能顶掉的最大可用羊拦截
 *      ② 空赛道 → 用最小羊铺满（占位防守）
 *      ③ 对手某赛道无防守 → 放最强羊突破
 *      ④ 手里同级羊多 → 优先消耗（压制对手同赛道）
 */
(function (global) {
  'use strict';
  var YT = global.YT;

  function avail(state, slot, lv, now) {
    if (state.cool[slot] === undefined) return false;
    return state.hands[slot].indexOf(lv) >= 0;
  }
  function laneReady(state, slot, lane, now) {
    return now >= (state.cool[slot][lane] || 0);
  }
  // 该赛道我方最强羊的等级（无则 0）
  function myBest(state, slot, lane) {
    var best = 0;
    state.sheep.forEach(function (sh) { if (sh.slot === slot && sh.lane === lane) best = Math.max(best, sh.lv); });
    return best;
  }
  // 该赛道对方最强羊的等级 + 位置
  function foeBest(state, slot, lane) {
    var best = { lv: 0, pos: 0 };
    state.sheep.forEach(function (sh) {
      if (sh.slot !== slot && sh.lane === lane && sh.lv >= best.lv) { best = { lv: sh.lv, pos: sh.pos }; }
    });
    return best;
  }

  /** 返回 {lane, lv} 或 null */
  function decide(state, slot, now) {
    if (!state || state.winner >= 0 || !state.started) return null;
    if (!state.hands || !state.hands[slot]) return null;
    var hand = state.hands[slot];
    if (!hand.length) return null;
    var lanes = state.lanes || 4;

    // 可用（赛道未冷却）的赛道列表
    var ready = [];
    for (var l = 0; l < lanes; l++) if (laneReady(state, slot, l, now)) ready.push(l);
    if (!ready.length) return null;

    var uniq = hand.slice().sort(function (a, b) { return a - b; });   // 升序
    var max = uniq[uniq.length - 1];
    var min = uniq[0];

    // ① 拦截：对手羊已过半程且能被我方顶掉
    var threat = null;
    ready.forEach(function (l) {
      var foe = foeBest(state, slot, l);
      if (!foe.lv || foe.pos < 35) return;
      var mine = myBest(state, slot, l);
      if (foe.lv <= mine) return;                       // 已有能顶住的
      // 需要放 > foe.lv 的羊（同级会同归于尽，也算有效防守）
      var need = foe.lv;
      var pick = -1;
      uniq.forEach(function (lv) { if (lv >= need && (pick < 0 || lv < pick)) pick = lv; });
      if (pick < 0) { pick = max; }                     // 手里都更弱：用最大的尽力拦
      var score = foe.pos + foe.lv * 10;
      if (!threat || score > threat.score) threat = { lane: l, lv: pick, score: score };
    });
    if (threat) return { lane: threat.lane, lv: threat.lv };

    // ② 铺赛道：空赛道（无我方羊、且对手有羊或为空）→ 用最小羊占位
    var empty = ready.filter(function (l) { return myBest(state, slot, l) === 0; });
    if (empty.length) {
      // 优先铺对手正在推进的赛道
      var urgent = empty.filter(function (l) { return foeBest(state, slot, l).lv > 0; });
      var target = urgent.length ? urgent[0] : empty[0];
      return { lane: target, lv: min };
    }

    // ③ 突破：对手该赛道无防守（或防守弱）→ 放最强羊
    var breach = ready.filter(function (l) { return foeBest(state, slot, l).lv === 0; });
    if (breach.length) return { lane: breach[0], lv: max };

    // ④ 同赛道加码：我方已有羊但对手更强 → 补一只更强的（手牌允许时）
    var cand = null;
    ready.forEach(function (l) {
      var foe = foeBest(state, slot, l);
      if (foe.lv && foe.lv >= myBest(state, slot, l) && max > foe.lv) {
        if (!cand) cand = { lane: l, lv: max };
      }
    });
    if (cand) return cand;

    // ⑤ 默认：随机可用赛道放最小羊（保持压力）
    return { lane: ready[Math.floor(Math.random() * ready.length)], lv: min };
  }

  global.YtAI = { decide: decide };
})(typeof window !== 'undefined' ? window : globalThis);
