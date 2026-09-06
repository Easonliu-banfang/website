/* 围棋 AI —— 启发式落子（非搜索），同步运行，休闲可玩。
 * 对每个空点模拟落子，按「提子数 + 己方气 - 送吃/填眼惩罚」打分，取最优；无好棋则 pass。
 */
(function (global) {
  'use strict';

  var DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  function cloneState(s) {
    return {
      size: s.size, board: s.board.map(function (row) { return row.slice(); }),
      turn: s.turn, ko: s.ko ? s.ko.slice() : null,
      captures: { 1: s.captures[1], 2: s.captures[2] },
      passes: s.passes, winner: s.winner, history: s.history, score: s.score
    };
  }

  function isOwnEye(s, r, c, p) {
    if (s.board[r][c] !== 0) return false;
    for (var d = 0; d < 4; d++) {
      var nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (nr < 0 || nr >= s.size || nc < 0 || nc >= s.size) continue;
      if (s.board[nr][nc] !== p) return false;
    }
    return true;
  }

  function evalMove(s, p, r, c) {
    var clone = cloneState(s);
    var ok = global.Go.place(clone, p, r, c);
    if (!ok) return -Infinity;
    var cap = clone.captures[p] - s.captures[p];
    var sc = cap * 12;
    var g = global.Go.group(clone, r, c);
    sc += g.libs.length * 1.2;
    if (g.libs.length <= 1 && cap === 0) sc -= 50;       // 送吃
    if (isOwnEye(s, r, c, p)) sc -= 80;                  // 填自己的眼
    return sc;
  }

  function nextMove(s, me) {
    if (s.winner >= 0) return null;
    var opp = 3 - me;
    var best = null, bestVal = -1e9;
    for (var r = 0; r < s.size; r++) {
      for (var c = 0; c < s.size; c++) {
        if (s.board[r][c] !== 0) continue;
        if (s.ko && s.ko[0] === r && s.ko[1] === c) continue;
        var v = evalMove(s, me, r, c);
        if (v > bestVal) { bestVal = v; best = [r, c]; }
      }
    }
    // 终局处理：对手已 pass 且我无吃子好棋 → 也 pass 收官
    if (s.passes >= 1 && best && (bestVal < 1 || (global.Go.groupAfter ? 0 : 0))) {
      // 若最优也只是送吃/填眼，直接 pass
      var clone = cloneState(s);
      var ok = global.Go.place(clone, me, best[0], best[1]);
      if (!ok || (clone.captures[me] - s.captures[me] === 0 && global.Go.group(clone, best[0], best[1]).libs.length <= 1)) {
        return null;
      }
    }
    if (!best || bestVal < -10) return null;   // 没有好棋 → pass
    return best;
  }

  global.GoAI = { nextMove: nextMove };
})(typeof window !== 'undefined' ? window : globalThis);
