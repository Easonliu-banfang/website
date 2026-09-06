/* 五子棋（Gomoku）规则引擎 —— 标准 15x15，无禁手休闲版，纯逻辑无 DOM。
 *
 * 状态：
 *   board : 15x15，0 空 / 1 黑 / 2 白
 *   turn  : 当前落子方（1 黑 / 2 白），黑先
 *   winner: -1 未分 / 1 黑胜 / 2 白胜 / 0 平（满盘）
 *   last  : [r,c] 最后一手（用于高亮）
 *   history: [{r,c,p}]
 */
(function (global) {
  'use strict';

  var SIZE = 15;

  function createState() {
    var board = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(0);
      board.push(row);
    }
    return {
      size: SIZE,
      board: board,
      turn: 1,
      winner: -1,
      last: null,
      history: []
    };
  }

  function inBoard(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  // 落子。返回 true/false（非法）
  function place(state, p, r, c) {
    if (state.winner >= 0) return false;
    if (state.turn !== p) return false;
    if (!inBoard(r, c) || state.board[r][c] !== 0) return false;
    state.board[r][c] = p;
    state.last = [r, c];
    state.history.push({ r: r, c: c, p: p });
    // 判胜
    if (checkWin(state, r, c, p)) {
      state.winner = p;
    } else if (state.history.length >= SIZE * SIZE) {
      state.winner = 0;
    } else {
      state.turn = 3 - p;
    }
    return true;
  }

  // 四个方向：横、竖、主对角、副对角
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function checkWin(state, r, c, p) {
    for (var d = 0; d < DIRS.length; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      var count = 1;
      // 正向
      var rr = r + dr, cc = c + dc;
      while (inBoard(rr, cc) && state.board[rr][cc] === p) { count++; rr += dr; cc += dc; }
      // 反向
      rr = r - dr; cc = c - dc;
      while (inBoard(rr, cc) && state.board[rr][cc] === p) { count++; rr -= dr; cc -= dc; }
      if (count >= 5) return true;
    }
    return false;
  }

  // 合法落子点（用于 AI / 联机校验 / 和棋判定）
  function legalMoves(state) {
    var out = [];
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++)
        if (state.board[r][c] === 0) out.push([r, c]);
    return out;
  }

  // 重置时随机先手（五子棋传统黑先，但保留随机以消先手优势，可选）
  function reset(state) {
    var s = createState();
    return s;
  }

  global.Gomoku = {
    SIZE: SIZE,
    createState: createState,
    place: place,
    checkWin: checkWin,
    legalMoves: legalMoves,
    reset: reset,
    inBoard: inBoard
  };
})(typeof window !== 'undefined' ? window : globalThis);
