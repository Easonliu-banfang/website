/* 优诺 UNO 联机 AI 代打（简易策略，供 BotDriver 调用）
 * state 为服务端下发的裁剪视图：top/topColor/turn/nextDraw/awaitColor/justDrew/winner
 * hand 为「归我代打的 AI 槽位」之手牌（服务端在 state.ai[slot] 补发）
 * 返回动作对象或动作数组（出到剩 1 张时附 callUno），带 as:slot 由上层补发
 */
(function () {
  'use strict';
  var COLORS = ['r', 'g', 'b', 'y'];

  function colorOf(id) { return id.charAt(0); }
  function kindOf(id) {
    if (id === 'w') return 'w';
    if (id === 'w4') return 'w4';
    var k = id.slice(1);
    if (k === 's') return 's';
    if (k === 'r') return 'r';
    if (k === 'd') return 'd';
    return 'n';
  }
  function isPlayable(state, id) {
    var k = kindOf(id);
    if (k === 'w' || k === 'w4') return true;
    if (state.topColor && colorOf(id) === state.topColor) return true;
    var tk = kindOf(state.top);
    if (tk === k) { if (k === 'n') return id.slice(1) === state.top.slice(1); return true; }
    return false;
  }
  function bestColor(hand) {
    var cnt = { r: 0, g: 0, b: 0, y: 0 };
    hand.forEach(function (c) { var col = colorOf(c); if (cnt[col] != null) cnt[col]++; });
    var best = 'r', bestN = -1;
    COLORS.forEach(function (c) { if (cnt[c] > bestN) { bestN = cnt[c]; best = c; } });
    return best;
  }
  function pickCard(playable) {
    // 策略：优先甩出 +2/反转/跳过 给对方压力，最后才动用万能牌（留 w4）
    var score = { d: 5, r: 4, s: 3, n: 2, w: 1, w4: 0 };
    playable.sort(function (a, b) { return (score[kindOf(b)] || 0) - (score[kindOf(a)] || 0); });
    return playable[0];
  }

  function choose(state, s, hand) {
    if (state.winner != null && state.winner >= 0) return null;
    if (state.turn !== s) return null;
    // 刚出万能牌 → 选色（回合不推进，等出牌者选）
    if (state.awaitColor) return { type: 'setColor', color: bestColor(hand), as: s };
    // 被 +2/+4 罚时：优先用 +2 / 万色+4 叠加甩给下家，无牌才接受惩罚
    if (state.nextDraw > 0) {
      var stackSet = hand.filter(function (c) { var k = kindOf(c); return k === 'w4' || (k === 'd' && isPlayable(state, c)); });
      if (stackSet.length) {
        var sc = pickCard(stackSet);
        var sActs = [{ type: 'play', card: sc, as: s }];
        if (hand.length - 1 === 1) sActs.push({ type: 'callUno', as: s });
        return sActs;
      }
      return { type: 'draw', as: s };
    }
    var playable = hand.filter(function (c) { return isPlayable(state, c); });
    // 官方规则：主动摸牌后只能出刚摸的那张（或过），不能再出原有牌
    if (state.justDrew && state.lastDrawn) playable = playable.filter(function (c) { return c === state.lastDrawn; });
    if (playable.length) {
      var card = pickCard(playable);
      var acts = [{ type: 'play', card: card, as: s }];
      if (hand.length - 1 === 1) acts.push({ type: 'callUno', as: s });   // 出到剩 1 张 → 喊 UNO
      return acts;
    }
    // 无牌可出
    if (state.justDrew) return { type: 'pass', as: s };   // 刚摸过 → 过牌
    return { type: 'draw', as: s };
  }

  (typeof window !== 'undefined' ? window : globalThis).UnoAI = { choose: choose, isPlayable: isPlayable, colorOf: colorOf, kindOf: kindOf };
})();
