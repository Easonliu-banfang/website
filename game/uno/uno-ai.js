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
    if (k === 'w') return true;
    // 万色+4：官方规则要求手中没有任何「与当前颜色匹配」的牌才可出（同数字不同色不算）
    if (k === 'w4') {
      if (state.nextDraw > 0) return false;   // 罚期不能出（本引擎不支持叠牌）
      if (!state.topColor) return true;
      return !(state.hand || []).some(function (c) {
        var kk = kindOf(c);
        if (kk === 'w' || kk === 'w4') return false;
        return colorOf(c) === state.topColor;
      });
    }
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
    // 被 +2/+4 罚时：本引擎不支持「叠牌」（nextDraw>0 时 play 被拒，只能 draw），
    // 按引擎规则直接接受惩罚摸牌（摸完自动过）
    if (state.nextDraw > 0) {
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
