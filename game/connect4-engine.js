/* 四子棋（Connect Four）规则引擎 —— 7 列 x 6 行，列落子（重力），四连判胜，纯逻辑无 DOM。
 *
 * 状态：
 *   board : 6x7，r=0 顶行 ~ r=5 底行；0 空 / 1 红 / 2 蓝
 *   turn  : 当前落子方（1 红先 / 2 蓝）
 *   winner: -1 未分 / 1 红胜 / 2 蓝胜 / 0 平（满盘）
 *   last  : [r,c] 最后一手（棋子落点，用于动画/高亮）
 *   history: [{col,p}] 落子列（供回放与 undo）
 */
(function (global) {
  'use strict';

  var ROWS = 6, COLS = 7;

  function createState() {
    var board = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < COLS; c++) row.push(0);
      board.push(row);
    }
    return {
      rows: ROWS, cols: COLS,
      board: board,
      turn: 1,
      winner: -1,
      last: null,
      history: []
    };
  }

  // 某列可否落子（未满，且未判胜）
  function canDrop(state, col) {
    if (state.winner >= 0) return false;
    if (col < 0 || col >= COLS) return false;
    return state.board[0][col] === 0;   // 顶行空 = 该列未满
  }
  function legalMoves(state) {
    var arr = [];
    for (var c = 0; c < COLS; c++) if (canDrop(state, c)) arr.push(c);
    return arr;
  }
  // 该列当前空位的行号（顶→底扫描第一个空），无则 -1
  function dropRow(state, col) {
    for (var r = ROWS - 1; r >= 0; r--) if (state.board[r][col] === 0) return r;
    return -1;
  }

  // 落子：按「重力」进入指定列的最低空位。返回 {ok,row,col}（row 为棋子落点）
  function drop(state, p, col) {
    if (state.winner >= 0) return { ok: false, err: 'game over' };
    if (state.turn !== p) return { ok: false, err: 'not your turn' };
    if (!canDrop(state, col)) return { ok: false, err: 'column full' };
    var r = dropRow(state, col);
    state.board[r][col] = p;
    state.last = [r, col];
    state.history.push({ col: col, p: p });
    if (checkWinAt(state, r, col, p)) {
      state.winner = p;
    } else if (state.history.length >= ROWS * COLS) {
      state.winner = 0;
    } else {
      state.turn = 3 - p;
    }
    return { ok: true, row: r, col: col };
  }

  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

  // 从 (r,c) 出发沿 dr/dc 数连续同色数
  function lineLen(state, r, c, p, dr, dc) {
    var n = 0;
    var rr = r, cc = c;
    while (inBoard(rr, cc) && state.board[rr][cc] === p) { n++; rr += dr; cc += dc; }
    return n;
  }

  // 四连判胜（双向统计：正+反）
  function checkWinAt(state, r, c, p) {
    for (var d = 0; d < DIRS.length; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      var fwd = lineLen(state, r, c, p, dr, dc);          // 从落子点沿正向数
      var bwd = lineLen(state, r - dr, c - dc, p, -dr, -dc); // 从落子点反向数
      if (fwd + bwd >= 4) return true;
    }
    return false;
  }

  // 悔棋：撤回最后一手
  function undo(state) {
    if (!state.history.length) return false;
    var h = state.history.pop();
    var col = h.col;
    // 找到该列最高棋子（最后落下的就是该列当前最高位？不一定——但该列在落子后被放的棋子一定在该位置）
    for (var r = 0; r < ROWS; r++) {
      if (state.board[r][col] === h.p) { state.board[r][col] = 0; break; }
    }
    state.winner = -1;
    state.turn = h.p;
    state.last = state.history.length ? null : null;
    if (state.history.length) {
      var lh = state.history[state.history.length - 1];
      state.last = findLastPos(state, lh.col, lh.p);
    }
    return true;
  }

  // 由列找该玩家棋子位置（用于 undo 后高亮）
  function findLastPos(state, col, p) {
    for (var r = 0; r < ROWS; r++) if (state.board[r][col] === p) return [r, col];
    return null;
  }

  function reset() { return createState(); }

  global.Connect4 = {
    ROWS: ROWS, COLS: COLS,
    createState: createState,
    canDrop: canDrop,
    legalMoves: legalMoves,
    drop: drop,
    dropRow: dropRow,
    checkWinAt: checkWinAt,
    undo: undo,
    reset: reset,
    inBoard: inBoard
  };
})(typeof window !== 'undefined' ? window : globalThis);