/* 四子棋 AI —— 永从中心列（第 4 列，index 3）开局；此后启发式：
 * 优先自己成四赢棋 → 堵对手成四 → 做/堵三连威胁 → 中心偏好。同步执行（局面小）。
 */
(function (global) {
  'use strict';

  var C = global.Connect4;
  var CENTER = 3;   // 0-based 中心列

  function bestMove(state, p) {
    var moves = C.legalMoves(state);
    if (!moves.length) return null;

    // 开局（空盘/第一手）：永远中心列
    if (state.history.length === 0) {
      return (moves.indexOf(CENTER) >= 0) ? CENTER : moves[Math.floor(moves.length / 2)];
    }

    var opp = 3 - p;
    var best = null, bestScore = -Infinity;

    for (var i = 0; i < moves.length; i++) {
      var col = moves[i];
      var score = evalMove(state, col, p, opp);
      // 中心偏好：列越靠中得分越高（轻微）
      score += (CENTER - Math.abs(col - CENTER)) * 0.2;
      if (score > bestScore) { bestScore = score; best = col; }
    }
    return best;
  }

  // 对某一列落子的评分（红方视角 p 得分高好，opp 维度沉重惩罚）
  function evalMove(state, col, p, opp) {
    var rows = state.rows, cols = state.cols;

    // 模拟 p 落子
    var r = C.dropRow(state, col);
    if (r < 0) return -9999;

    // 1) 自己落子后成四 → 必胜
    if (C.checkWinAt(state, r, col, p)) return 100000;

    // 2) 对手若落此列会成四 → 立即堵
    if (C.checkWinAt(state, r, col, opp)) return 50000;

    // 3) 通用评价：对 (r,col) 为中心的所有窗打分
    var pScore = windowScore(state, r, col, p, opp);

    // 4) 考虑「若我不堵，对手下一步在哪成四」——已有第 2 条覆盖堵，再加一层威胁观察：
    //    对手在相邻列垂直落子是否成三（逼近成四）
    var oppThreat = 0;
    for (var dc2 = -3; dc2 <= 3; dc2++) {
      var c2 = col + dc2;
      if (c2 < 0 || c2 >= cols) continue;
      var r2 = C.dropRow(state, c2);
      if (r2 < 0) continue;
      if (C.checkWinAt(state, r2, c2, opp)) oppThreat += 3000; // 对手下一步即成四（我方应优先防）
    }

    return pScore - oppThreat;
  }

  // 以 (r,c) 为落子点，统计经过它的四条线上 p 的威胁与 opp 的威胁
  function windowScore(state, r, c, p, opp) {
    var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    var score = 0;
    for (var d = 0; d < dirs.length; d++) {
      var dr = dirs[d][0], dc = dirs[d][1];
      var pRun = runLen(state, r, c, p, dr, dc);
      var oRun = runLen(state, r, c, opp, dr, dc);
      if (oRun === 0) {
        // 该方向无对手阻挡：p 的连子规模越大分越高（成 3 威胁 1200，成 2 起步 200）
        score += (pRun === 3) ? 1200 : (pRun === 2) ? 200 : 30;
      }
      if (pRun === 0) {
        // 该方向无我阻挡：对手连子大说明我方应防守
        score -= (oRun === 3) ? 900 : (oRun === 2) ? 150 : 10;
      }
    }
    return score;
  }

  // 经过 (r,c) 且沿 (dr,dc) 与反向形成的「同色连续窗」长度（含两端空位忽略）
  function runLen(state, r, c, p, dr, dc) {
    var rows = state.rows, cols = state.cols;
    if (!C.inBoard(r, c) || state.board[r][c] !== p) return 0;
    var n = 1;
    for (var s = -1; s <= 1; s += 2) {
      var rr = r + dr * s, cc = c + dc * s;
      while (C.inBoard(rr, cc) && state.board[rr][cc] === p) { n++; rr += dr * s; cc += dc * s; }
    }
    return n;
  }

  global.Connect4AI = {
    bestMove: bestMove,
    CENTER: CENTER
  };
})(typeof window !== 'undefined' ? window : globalThis);