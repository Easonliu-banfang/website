/* 五子棋 AI —— 棋型评分启发式（无搜索/浅搜），同步运行，足够休闲对战。
 * 评估每个空点：自己落子的进攻分 + 对手落子的防守分，取最优。
 */
(function (global) {
  'use strict';

  var SIZE = 15;
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  // 给定虚拟棋盘（已假设 p 落在 r,c），对某一方向返回棋型分
  function lineScore(bd, r, c, p, dr, dc) {
    // 正向连续
    var cnt = 1;
    var rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] === p) { cnt++; rr += dr; cc += dc; }
    var plusOpen = (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] === 0) || (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && false);
    var plusEmpty = (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] === 0);
    // 反向连续
    rr = r - dr; cc = c - dc;
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] === p) { cnt++; rr -= dr; cc -= dc; }
    var minusEmpty = (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] === 0);

    if (cnt >= 5) return 100000;
    var openEnds = (plusEmpty ? 1 : 0) + (minusEmpty ? 1 : 0);
    if (cnt === 4) {
      if (openEnds === 2) return 12000;   // 活四
      if (openEnds === 1) return 2000;    // 冲四
      return 0;
    }
    if (cnt === 3) {
      if (openEnds === 2) return 1500;    // 活三
      if (openEnds === 1) return 300;     // 眠三
      return 0;
    }
    if (cnt === 2) {
      if (openEnds === 2) return 200;     // 活二
      if (openEnds === 1) return 40;
      return 0;
    }
    if (cnt === 1) {
      if (openEnds === 2) return 20;
      if (openEnds === 1) return 5;
    }
    return 0;
  }

  // 评估在 (r,c) 为 p 落子后的总棋型分（四方向求和）
  function scoreFor(bd, r, c, p) {
    var total = 0;
    // 临时落子
    bd[r][c] = p;
    for (var d = 0; d < DIRS.length; d++) {
      total += lineScore(bd, r, c, p, DIRS[d][0], DIRS[d][1]);
    }
    bd[r][c] = 0;
    return total;
  }

  // 返回最佳落子 [r,c]，me=AI 方，opp=对手
  function nextMove(state, me) {
    var bd = state.board;
    var opp = 3 - me;
    var best = null, bestVal = -1;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (bd[r][c] !== 0) continue;
        // 只在与已有棋子相邻（含距离 2）附近搜索，避免太散
        var near = false;
        for (var dr = -2; dr <= 2 && !near; dr++)
          for (var dc = -2; dc <= 2; dc++) {
            var rr = r + dr, cc = c + dc;
            if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] !== 0) { near = true; break; }
          }
        if (!near && state.history.length > 0) continue;
        var atk = scoreFor(bd, r, c, me);
        var def = scoreFor(bd, r, c, opp);
        var val = atk * 1.0 + def * 0.92;
        if (val > bestVal) { bestVal = val; best = [r, c]; }
      }
    }
    // 空盘：落中央
    if (!best) best = [7, 7];
    return best;
  }

  global.GomokuAI = { nextMove: nextMove };
})(typeof window !== 'undefined' ? window : globalThis);
