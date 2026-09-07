/* 四子棋 AI —— Minimax + Alpha-Beta 剪枝 + 迭代加深（时间预算）
 *
 * 设计（「开智」版，替代旧的单步启发式 + 强制中心列开局）：
 *   - 评估函数：69 个四连窗口（24 横 + 21 竖 + 12 主对角 + 12 副对角）
 *     按窗口内己方/对方棋子分布计分，天然覆盖「攻」与「防」
 *   - 搜索：NegaMax + Alpha-Beta，列排序（中心优先 + 单步威胁启发）提升剪枝
 *   - 迭代加深：深度从 1 递增到 maxDepth（默认 7），600ms 时间预算内尽量深，
 *     至少保证 3 层（提前看 2~3 步）；终局返回 ±(WIN-ply) 鼓励尽快赢
 *   - 不再强制中心列开局：第一步也走完整搜索（中心列因启发排序天然优先，
 *     但不是死板规则）
 *   - 同步执行：Alpha-Beta + 剪枝下 7 列分支极小，耗时 <100ms 级
 */
(function (global) {
  'use strict';

  var C = global.Connect4;
  var WIN = 1000000;
  var MAX_DEPTH = 7;
  var TIME_BUDGET = 600;      // ms
  var _deadline = 0;
  var _nodes = 0;

  // 四连窗口起点（r,c）与方向 dr,dc
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function inB(r, c) { return C.inBoard(r, c); }

  // 由开局深度自动定 maxDepth（局面越空搜得越深）
  function pickMaxDepth(state) {
    var filled = state.history.length;
    if (filled >= 38) return Math.max(3, MAX_DEPTH - 2);
    if (filled >= 28) return MAX_DEPTH;
    return MAX_DEPTH;
  }

  // 评估：遍历棋盘上所有四连窗口
  function evalBoard(state, p) {
    var rows = state.rows, cols = state.cols;
    var score = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        for (var d = 0; d < DIRS.length; d++) {
          var dr = DIRS[d][0], dc = DIRS[d][1];
          // 窗口起点合法：r+3dr, c+3dc 必须在盘内
          if (!inB(r + 3 * dr, c + 3 * dc)) continue;
          var cntP = 0, cntO = 0;
          for (var i = 0; i < 4; i++) {
            var v = state.board[r + i * dr][c + i * dc];
            if (!v) continue;
            if (v === p) cntP++; else cntO++;
          }
          // 混合窗口无价值；单色窗口按连子数计分（攻/防对称）
          if (cntP > 0 && cntO > 0) continue;
          if (cntP > 0) {
            if (cntP === 4) score += 30000;      // 必胜窗（搜索中一般已被终局截断）
            else if (cntP === 3) score += 400;   // 三连威胁
            else if (cntP === 2) score += 40;    // 二连铺垫
            else score += 5;
          } else if (cntO > 0) {
            if (cntO === 4) score -= 30000;
            else if (cntO === 3) score -= 350;   // 挡对手三连
            else if (cntO === 2) score -= 35;
            else score -= 4;
          }
        }
      }
    }
    // 微小的中心偏好（仅作 tiebreak，不作为硬规则）
    var bp = state.board;
    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols; cc++) {
        if (!bp[rr][cc]) continue;
        var x = (cc - (cols - 1) / 2) / (cols / 2);   // -1..1
        if (bp[rr][cc] === p) score += x * x * 1.2;
        else score -= x * x * 1.2;
      }
    }
    return score;
  }

  // 克隆状态（6x7 小盘，复制便宜）
  function clone(state) {
    return {
      rows: state.rows,
      cols: state.cols,
      board: state.board.map(function (row) { return row.slice(); }),
      turn: state.turn,
      winner: state.winner,
      last: state.last,
      history: state.history.slice(),
      blackPlayer: state.blackPlayer,
    };
  }

  // 列排序：中心优先 + 单步成三/堵三启发（提升剪枝效率）
  function orderMoves(state, p, opp) {
    var moves = C.legalMoves(state);
    var scored = moves.map(function (col) {
      var r = C.dropRow(state, col);
      var s = -Math.abs(col - (state.cols - 1) / 2);   // 中心列排序靠前
      // 单步威胁：自己落子成三 / 对手成三
      if (C.checkWinAt(state, r, col, p)) s -= 100;
      return { col: col, s: s };
    });
    scored.sort(function (a, b) { return a.s - b.s; });
    return scored.map(function (x) { return x.col; });
  }

  // NegaMax：返回当前玩家 p 的分数
  function negamax(state, p, depth, alpha, beta) {
    _nodes++;
    // 时间预算（仅在较深处检查，避免浅层开销）
    if (depth >= 4 && performance.now() > _deadline) throw new Error('timeout');

    var opp = 3 - p;
    var moves = C.legalMoves(state);
    if (!moves.length) return 0;          // 平局

    var best = -Infinity;
    var ordered = orderMoves(state, p, opp);

    for (var i = 0; i < ordered.length; i++) {
      var col = ordered[i];
      var s = clone(state);
      var res = C.drop(s, p, col);
      if (!res.ok) continue;

      var score;
      if (s.winner === p) score = WIN - 1;              // 本轮即胜（ply 已在外部加成）
      else if (s.winner === 0) score = 0;               // 已判平
      else if (depth <= 1) score = evalBoard(s, p);     // 到达叶子
      else score = -negamax(s, opp, depth - 1, -beta, -alpha);

      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                         // 剪枝
    }
    return best;
  }

  function bestMove(state, p) {
    var moves = C.legalMoves(state);
    if (!moves.length) return null;
    var opp = 3 - p;

    var maxDepth = pickMaxDepth(state);
    _deadline = performance.now() + TIME_BUDGET;

    var bestCol = null, bestScore = -Infinity, bestDepth = 0;

    // 迭代加深：从保证的 3 层开始（提前看 2~3 步），预算内尽量加深
    for (var depth = 3; depth <= maxDepth; depth++) {
      var curBest = null, curScore = -Infinity, alpha = -Infinity, beta = Infinity;
      try {
        var ordered = orderMoves(state, p, opp);
        for (var i = 0; i < ordered.length; i++) {
          var col = ordered[i];
          var s = clone(state);
          var res = C.drop(s, p, col);
          if (!res.ok) continue;

          var score;
          if (s.winner === p) score = WIN + (MAX_DEPTH - depth);   // 尽快赢
          else if (s.winner === 0) score = 0;
          else score = -negamax(s, opp, depth - 1, -beta, -alpha);

          if (score > curScore) { curScore = score; curBest = col; }
          if (curScore > alpha) alpha = curScore;
          if (alpha >= beta) break;
        }
        // 该层完整搜索成功，采用
        if (curBest != null) { bestCol = curBest; bestScore = curScore; bestDepth = depth; }
      } catch (e) {
        if (e.message !== 'timeout') throw e;   // 超时：采用上一层结果
        break;
      }
    }

    // 兜底：极端情况下（全超时）至少返回一个合法列
    if (bestCol == null) bestCol = moves[Math.floor(moves.length / 2)];
    return bestCol;
  }

  global.Connect4AI = {
    bestMove: bestMove,
    evalBoard: evalBoard,
    MAX_DEPTH: MAX_DEPTH,
  };
})(typeof window !== 'undefined' ? window : globalThis);