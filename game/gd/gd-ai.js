/* 掼蛋 AI（供 BotDriver 代打）：简单启发式
 * state 为服务端下发的裁剪视图 + state.ai[slot] = 该 AI 手牌
 * 阶段：playing（出/过）、tribute（贡最大）、tributeReturn（还 ≤10 最小）
 */
(function (global) {
  'use strict';
  var GD = global.GD;

  function orderOf(card, level) { return GD.orderKey(GD.codeOf(card), level); }

  // 从手牌枚举「能压过 last 的最小组合」
  function findBeat(hand, level, last) {
    var target = last.shape;
    var tier = GD.tierOf(target);
    var i, c, cards, interps, j;

    if (tier === 0) {
      // 同型最小压制
      var byCode = {};
      hand.forEach(function (cc) {
        var k = GD.codeOf(cc);
        (byCode[k] = byCode[k] || []).push(cc);
      });
      function pickOf(code, n) {
        return (byCode[code] || []).slice().sort(function (a, b) { return a - b; }).slice(0, n);
      }
      function tryKind(kind, needMain, needKicker) {
        // 找最小可压组合
        var codes = Object.keys(byCode).map(Number).sort(function (a, b) { return orderOf(pickOf(a, 1)[0], level) - orderOf(pickOf(b, 1)[0], level); });
        for (var ci = 0; ci < codes.length; ci++) {
          var code = codes[ci];
          var ok = orderOf(pickOf(code, 1)[0], level) > target.key;
          if (!ok) continue;
          var main = pickOf(code, needMain);
          if (main.length < needMain) continue;
          var rest = hand.filter(function (x) { return main.indexOf(x) < 0; });
          var kick = [];
          if (needKicker > 0) {
            // 找最小的 kicker 对/三张
            var byC = {};
            rest.forEach(function (cc) { var k = GD.codeOf(cc); (byC[k] = byC[k] || []).push(cc); });
            var ks = Object.keys(byC).map(Number).sort(function (a, b) {
              var oa = orderOf(byC[a][0], level), ob = orderOf(byC[b][0], level);
              return oa - ob;
            });
            for (var ki = 0; ki < ks.length; ki++) {
              if (byC[ks[ki]].length >= needKicker && ks[ki] !== code) {
                kick = byC[ks[ki]].slice(0, needKicker);
                break;
              }
            }
            if (kick.length < needKicker) continue;
          }
          return main.concat(kick);
        }
        return null;
      }
      var r = null;
      if (target.k === 'single') { r = tryKind('single', 1, 0); }
      else if (target.k === 'pair') { r = tryKind('pair', 2, 0); }
      else if (target.k === 'trio') { r = tryKind('trio', 3, 0); }
      else if (target.k === 'trioPlusPair') { r = tryKind('trioPlusPair', 3, 2); }
      // 顺子/连对/钢板：枚举窗口
      if (!r && (target.k === 'straight' || target.k === 'flushStraight')) {
        var wins = straightWins(target.key);
        for (i = 0; i < wins.length && !r; i++) {
          r = tryWindow(hand, level, wins[i], 1, 5, target.key);
        }
      }
      if (!r && target.k === 'trioRun') {
        var rw = runWins(3, target.key);
        for (i = 0; i < rw.length && !r; i++) r = tryWindow(hand, level, rw[i], 2, 6, target.key);
      }
      if (r) { interps = GD.interpret(r, level); for (j = 0; j < interps.length; j++) if (GD.beats(interps[j], target)) return { cards: r, interpId: j }; }
      // 顺子等找不到 → 落到炸弹
    }
    // 炸弹压（任何非炸弹或更小炸弹）
    var bombs = [];
    var byC2 = {};
    hand.forEach(function (cc) { var k = GD.codeOf(cc); if (!GD.isJoker(cc)) (byC2[k] = byC2[k] || []).push(cc); });
    Object.keys(byC2).forEach(function (k) {
      k = Number(k);
      if (byC2[k].length >= 4) {
        var size = byC2[k].length;
        var key = orderOf(byC2[k][0], level);
        var beatsLast = !last ? true : (tier === 4 ? false : (tier < 2 ? true : (GD.tierOf({ k: 'bomb', key: key, size: size }) > tier || (tier >= 1 && tier <= 3 && (size > (last.shape.size || 0) || (size === last.shape.size && key > last.shape.key))))));
        var beatsTarget = !last ? true : GD.beats({ k: 'bomb', key: key, size: size }, last.shape);
        if (beatsTarget) bombs.push({ cards: byC2[k].slice(), key: key, size: size });
      }
    });
    if (bombs.length) {
      bombs.sort(function (a, b) { return a.size - b.size || a.key - b.key; });
      var bc = bombs[0].cards;
      var bi = GD.interpret(bc, level);
      for (var bi2 = 0; bi2 < bi.length; bi2++) if (GD.beats(bi[bi2], last ? last.shape : { k: 'single', key: -99 })) return { cards: bc, interpId: bi2 };
    }
    return null;
  }

  function straightWins(topKey) {
    // 由 topKey 反推所有 ≥ topKey 的 5 连窗口（不含级牌/王）
    var wins = [];
    for (var s = 3; s <= 10; s++) {
      var ranks = [s, s + 1, s + 2, s + 3, s + 4];
      wins.push(ranks);
    }
    return wins;
  }
  function runWins(len, topKey) {
    var wins = [];
    for (var s = 3; s + len - 1 <= 14; s++) {
      var ranks = [];
      for (var i = 0; i < len; i++) ranks.push(s + i);
      wins.push(ranks);
    }
    return wins;
  }
  function tryWindow(hand, level, ranks, need, total, minTopKey) {
    var picked = [];
    for (var i = 0; i < ranks.length; i++) {
      var cnt = 0;
      for (var j = 0; j < hand.length && cnt < need; j++) {
        if (GD.codeOf(hand[j]) === ranks[i] && picked.indexOf(hand[j]) < 0) { picked.push(hand[j]); cnt++; }
      }
      if (cnt < need) return null;
    }
    if (picked.length !== total) return null;
    var topOrder = GD.orderKey(ranks[ranks.length - 1], level);
    if (topOrder <= minTopKey) return null;
    return picked;
  }

  function decide(state, slot, hand) {
    if (!hand) return null;
    var level = state.level;
    if (state.phase === 'tribute') {
      var tri = GD.tributableCards({ phase: 'tribute', hand: { level: level, tribute: state.tribute, hands: handsFromView(state) } }, slot);
      if (tri.length) return { type: 'gd_tribute', card: tri[0], as: slot };
      return null;
    }
    if (state.phase === 'tributeReturn') {
      var ret = GD.returnableCards({ phase: 'tributeReturn', hand: { level: level, tribute: state.tribute, hands: handsFromView(state) } }, slot);
      if (ret.length) {
        ret.sort(function (a, b) { return orderOf(a, level) - orderOf(b, level); });
        return { type: 'gd_return', card: ret[0], as: slot };
      }
      return null;
    }
    if (state.phase !== 'playing' || state.turn !== slot) return null;
    if (state.winner != null && state.winner >= 0) return null;
    // 首出：出最小单张（有级牌在手先不出级牌）
    if (!state.last) {
      var sorted = GD.sortHand(hand, level);
      var card = sorted[sorted.length - 1];   // 最小（sortHand 降序，末尾最小）
      // 优先非级牌/非王
      for (var i = sorted.length - 1; i >= 0; i--) {
        if (GD.orderKey(GD.codeOf(sorted[i]), level) < 13) { card = sorted[i]; break; }
      }
      return { type: 'gd_play', cards: [card], interpId: 0, as: slot };
    }
    var beat = findBeat(hand, level, state.last);
    if (beat) return { type: 'gd_play', cards: beat.cards, interpId: beat.interpId, as: slot };
    return { type: 'gd_pass', as: slot };
  }
  function handsFromView(state) {
    // AI 阶段裁剪视图不含全 hands，构造占位（贡/还贡用 tributable/returnable 已在视图里给出）
    return [[], [], [], []];
  }
  // 贡/还贡直接用视图提供的列表
  function decide2(state, slot, hand) {
    if (state.phase === 'tribute' && state.tributable && state.tributable.length && state.turn === slot) {
      return { type: 'gd_tribute', card: state.tributable[0], as: slot };
    }
    if (state.phase === 'tributeReturn' && state.returnable && state.returnable.length && state.turn === slot) {
      var ret = state.returnable.slice().sort(function (a, b) { return GD.orderKey(GD.codeOf(a), state.level) - GD.orderKey(GD.codeOf(b), state.level); });
      return { type: 'gd_return', card: ret[0], as: slot };
    }
    return null;
  }

  var origDecide = decide;
  decide = function (state, slot, hand) {
    var r = decide2(state, slot, hand);
    if (r) return r;
    return origDecide(state, slot, hand);
  };

  global.GdAI = { decide: decide, findBeat: findBeat };
})(typeof window !== 'undefined' ? window : globalThis);
