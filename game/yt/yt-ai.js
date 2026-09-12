/* 顶哪个羊 AI（供 BotDriver 代打 / 本地 AI 模式）
 * 冷却按「羊（等级）」计：放出一只某等级羊后该等级进入冷却，期间不能再放同等级。
 * 策略：① 对手羊逼近我方基地 → 用能满足的最小等级拦截
 *      ② 空赛道（无我方羊）→ 用可用最小等级铺位
 *      ③ 对手无防守的赛道 → 放可用最大等级突破
 *      ④ 对手同赛道更强 → 补更强等级加码
 *      ⑤ 兜底：随机赛道放最小可用等级
 */
(function (global) {
  'use strict';
  var YT = global.YT;

  function readyAt(state, slot, lv) {
    return (state.cool && state.cool[slot] && state.cool[slot][lv]) || 0;
  }
  // 可用等级（手里有 + 未冷却）
  function availLevels(state, slot, now) {
    var hand = (state.hands && state.hands[slot]) || [];
    var out = [];
    for (var lv = 1; lv <= 4; lv++) {
      if (hand.indexOf(lv) >= 0 && now >= readyAt(state, slot, lv)) out.push(lv);
    }
    return out;   // 升序
  }
  function myBest(state, slot, lane) {
    var best = 0;
    state.sheep.forEach(function (sh) { if (sh.slot === slot && sh.lane === lane) best = Math.max(best, sh.lv); });
    return best;
  }
  function foeBest(state, slot, lane) {
    var best = { lv: 0, pos: 0 };
    state.sheep.forEach(function (sh) {
      if (sh.slot !== slot && sh.lane === lane && sh.lv >= best.lv) best = { lv: sh.lv, pos: sh.pos };
    });
    return best;
  }

  function decide(state, slot, now) {
    if (!state || state.winner >= 0 || !state.started) return null;
    var avail = availLevels(state, slot, now);
    if (!avail.length) return null;
    var lanes = state.lanes || 5;
    var allLanes = [];
    for (var l = 0; l < lanes; l++) allLanes.push(l);
    var minAv = avail[0], maxAv = avail[avail.length - 1];
    function pickAtLeast(need) {
      for (var i = 0; i < avail.length; i++) if (avail[i] >= need) return avail[i];
      return maxAv;   // 全都不够强 → 用最大的尽力拦
    }

    // ① 拦截：对手已过半程、该赛道我方顶不住
    var threat = null;
    allLanes.forEach(function (l) {
      var foe = foeBest(state, slot, l);
      if (!foe.lv || foe.pos < 35) return;
      if (foe.lv <= myBest(state, slot, l)) return;
      var use = pickAtLeast(foe.lv);
      var score = foe.pos + foe.lv * 10;
      if (!threat || score > threat.score) threat = { lane: l, lv: use, score: score };
    });
    if (threat) return { lane: threat.lane, lv: threat.lv };

    // ② 铺赛道：无我方羊的赛道（优先对手正在推进的）
    var empty = allLanes.filter(function (l) { return myBest(state, slot, l) === 0; });
    if (empty.length) {
      var urgent = empty.filter(function (l) { return foeBest(state, slot, l).lv > 0; });
      return { lane: urgent.length ? urgent[0] : empty[0], lv: minAv };
    }

    // ③ 突破：对手无防守的赛道 → 最大可用等级
    var breach = allLanes.filter(function (l) { return foeBest(state, slot, l).lv === 0; });
    if (breach.length) return { lane: breach[0], lv: maxAv };

    // ④ 加码：对手同赛道更强且我能补更强的
    var cand = null;
    allLanes.forEach(function (l) {
      var foe = foeBest(state, slot, l);
      if (foe.lv && foe.lv >= myBest(state, slot, l) && maxAv > foe.lv && !cand) cand = { lane: l, lv: maxAv };
    });
    if (cand) return cand;

    // ⑤ 兜底
    return { lane: allLanes[Math.floor(Math.random() * allLanes.length)], lv: minAv };
  }

  global.YtAI = { decide: decide, availLevels: availLevels };
})(typeof window !== 'undefined' ? window : globalThis);
