/* 骗子酒馆 联机 AI 代打（复用 liar-ai.js 的 LiarAI 决策，供 BotDriver 调用）
 * state 为服务端下发的裁剪视图：target/pileCount/lastPlay/current/phase/players
 * hand 为「归我代打的 AI 槽位」之手牌（服务端在 state.ai[slot] 补发）
 * 返回 {type:'play'|'challenge', as:slot}
 */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : globalThis;

  function decide(state, s, hand) {
    if (state.phase !== 'playing') return null;
    var id = String(s);
    if (state.current !== id) return null;
    if (!W.LiarAI) return null;

    // 没牌可出 → 只能质疑上家
    if (!hand || !hand.length) {
      if (state.lastPlay && state.lastPlay.player !== id) return { type: 'challenge', as: s };
      return null;
    }

    // 给 LiarAI 造一个最小 shim（只需 target / pile / lastPlay / player().hand）
    var shim = {
      target: state.target,
      pile: { length: state.pileCount },
      lastPlay: state.lastPlay,
      player: function (pid) {
        if (String(pid) === id) return { hand: hand };
        var pl = (state.players || []).filter(function (p) { return String(p.id) === String(pid); })[0];
        return { hand: pl ? new Array(pl.handCount || 0).fill(0) : [] };
      },
    };

    // 上家出过牌且不是自己 → 考虑质疑
    if (state.lastPlay && state.lastPlay.player !== id) {
      if (W.LiarAI.shouldChallenge(shim, id)) return { type: 'challenge', as: s };
    }
    // 否则出牌（LiarAI.chooseAI 返回 hand 中的索引数组）
    var idx = W.LiarAI.chooseAI(shim, id);
    if (idx && idx.length) return { type: 'play', indices: idx, as: s };
    return null;
  }

  (typeof window !== 'undefined' ? window : globalThis).LiarAIBot = { decide: decide };
})();
