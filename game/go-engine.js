/* 围棋（Go）规则引擎 —— 中国规则（数子法），纯逻辑无 DOM。
 * 支持 9 / 13 / 19 路；落子、气、提子、劫禁着、禁自杀、贴目、终局数子（含自动死活判定 + 可手动微调）。
 *
 * 状态：
 *   size      : 9 / 13 / 19
 *   board     : size×size，0 空 / 1 黑 / 2 白
 *   turn      : 当前落子方（1 黑 / 2 白），黑先
 *   ko        : 劫争禁着点 [r,c] 或 null
 *   captures  : {1: 黑提白数, 2: 白提黑数}
 *   passes    : 连续 pass 计数（2 即终局）
 *   winner    : -1 未终局 / 1 黑胜 / 2 白胜 / 0 和棋
 *   history   : [{r,c,p} | {pass:p}]
 *   score     : 终局后填（见 score()）
 */
(function (global) {
  'use strict';

  var KOMI = 6.5;          // 贴目（白方）
  var DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  function createState(size) {
    size = size || 19;
    var board = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) row.push(0);
      board.push(row);
    }
    return {
      size: size,
      board: board,
      turn: 1,
      ko: null,
      captures: { 1: 0, 2: 0 },
      passes: 0,
      winner: -1,
      history: [],
      score: null
    };
  }

  function inBoard(s, r, c) { return r >= 0 && r < s.size && c >= 0 && c < s.size; }

  // 取 (r,c) 同色连通块及其气（空点集合，键 "r,c"）
  function group(s, r, c) {
    var color = s.board[r][c];
    var stones = [], libs = {};
    if (color === 0) return null;
    var stack = [[r, c]], seen = {};
    seen[r + ',' + c] = 1;
    while (stack.length) {
      var cur = stack.pop();
      stones.push(cur);
      for (var d = 0; d < 4; d++) {
        var nr = cur[0] + DIRS[d][0], nc = cur[1] + DIRS[d][1];
        if (!inBoard(s, nr, nc)) continue;
        var v = s.board[nr][nc];
        if (v === 0) { libs[nr + ',' + nc] = 1; }
        else if (v === color && !seen[nr + ',' + nc]) { seen[nr + ',' + nc] = 1; stack.push([nr, nc]); }
      }
    }
    return { color: color, stones: stones, libs: Object.keys(libs) };
  }

  function removeGroup(s, stones) {
    for (var i = 0; i < stones.length; i++) s.board[stones[i][0]][stones[i][1]] = 0;
  }

  // 落子。返回 true/false（非法：越界/非空/劫/自杀）
  function place(s, p, r, c) {
    if (s.winner >= 0) return false;
    if (s.turn !== p) return false;
    if (!inBoard(s, r, c) || s.board[r][c] !== 0) return false;
    if (s.ko && s.ko[0] === r && s.ko[1] === c) return false;   // 劫禁着

    s.board[r][c] = p;
    var opp = 3 - p;
    var captured = [];
    for (var d = 0; d < 4; d++) {
      var nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (!inBoard(s, nr, nc) || s.board[nr][nc] !== opp) continue;
      var g = group(s, nr, nc);
      if (g && g.libs.length === 0) {
        for (var k = 0; k < g.stones.length; k++) captured.push(g.stones[k]);
      }
    }
    // 去重
    var seen = {}, uniq = [];
    for (var i = 0; i < captured.length; i++) {
      var key = captured[i][0] + ',' + captured[i][1];
      if (!seen[key]) { seen[key] = 1; uniq.push(captured[i]); }
    }
    captured = uniq;
    for (var j = 0; j < captured.length; j++) s.board[captured[j][0]][captured[j][1]] = 0;

    // 自杀判定（此时若无提子，自身气必为 0）
    var my = group(s, r, c);
    if (my.libs.length === 0) {
      s.board[r][c] = 0;          // 撤回
      return false;                // 自杀（无提子）
    }

    // 设置劫：单子提单子
    s.ko = null;
    if (captured.length === 1 && my.stones.length === 1) {
      s.ko = [captured[0][0], captured[0][1]];
    }
    s.captures[p] += captured.length;
    s.turn = opp;
    s.passes = 0;
    s.history.push({ r: r, c: c, p: p });
    return true;
  }

  function pass(s, p) {
    if (s.winner >= 0) return false;
    if (s.turn !== p) return false;
    s.ko = null;
    s.passes++;
    s.turn = 3 - p;
    s.history.push({ pass: p });
    if (s.passes >= 2) s.winner = -2;   // 双方 pass → 进入终局数子阶段（winner=-2 表示待数子）
    return true;
  }

  function cloneBoard(s) {
    return s.board.map(function (row) { return row.slice(); });
  }

  // 是否真眼（用于自动死活判定）。空点 (r,c) 视为 color 的真眼的条件：
  // 四个正交邻点均为 color（界外视为友好），且不超过 1 个对角为对方。
  function isTrueEye(s, r, c, color) {
    if (s.board[r][c] !== 0) return false;
    for (var d = 0; d < 4; d++) {
      var nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (!inBoard(s, nr, nc)) continue;            // 界外视为友好
      if (s.board[nr][nc] !== color) return false;   // 正交有异色 → 非眼
    }
    var diagOpp = 0;
    var diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (var i = 0; i < 4; i++) {
      var dr = r + diag[i][0], dc = c + diag[i][1];
      if (!inBoard(s, dr, dc)) continue;
      if (s.board[dr][dc] === (3 - color)) diagOpp++;
    }
    return diagOpp <= 1;
  }

  // 自动死活判定：没有真眼的同色块视为死子（保守：仅 0 真眼判死）。
  // 返回死子坐标数组 [[r,c]...]
  function autoDead(s) {
    var dead = [], seen = {};
    for (var r = 0; r < s.size; r++) {
      for (var c = 0; c < s.size; c++) {
        var v = s.board[r][c];
        if (v === 0) continue;
        var key = r + ',' + c;
        if (seen[key]) continue;
        var g = group(s, r, c);
        for (var k = 0; k < g.stones.length; k++) seen[g.stones[k][0] + ',' + g.stones[k][1]] = 1;
        var eyes = 0;
        // 该块相邻的空点中，有几个是其真眼
        var libSeen = {};
        for (var L = 0; L < g.libs.length; L++) {
          var lk = g.libs[L].split(',');
          var lr = +lk[0], lc = +lk[1];
          var ek = lr + ',' + lc;
          if (libSeen[ek]) continue; libSeen[ek] = 1;
          if (isTrueEye(s, lr, lc, v)) eyes++;
        }
        if (eyes === 0) { for (var m = 0; m < g.stones.length; m++) dead.push(g.stones[m]); }
      }
    }
    return dead;
  }

  // 终局数子（中国规则）：给定死子集合 dead，返回 {score1, score2, winner, territory, stones}
  function score(s, dead) {
    dead = dead || [];
    var board = cloneBoard(s);
    for (var i = 0; i < dead.length; i++) board[dead[i][0]][dead[i][1]] = 0;

    var territory = { 1: 0, 2: 0 }, stones = { 1: 0, 2: 0 };
    var visited = {};
    for (var r = 0; r < s.size; r++) {
      for (var c = 0; c < s.size; c++) {
        if (board[r][c] !== 0) { stones[board[r][c]]++; continue; }
        if (visited[r + ',' + c]) continue;
        // flood 空区域
        var region = [], borders = {}, stack = [[r, c]];
        visited[r + ',' + c] = 1;
        while (stack.length) {
          var cur = stack.pop(); region.push(cur);
          for (var d = 0; d < 4; d++) {
            var nr = cur[0] + DIRS[d][0], nc = cur[1] + DIRS[d][1];
            if (!inBoard(s, nr, nc)) continue;
            var v = board[nr][nc];
            if (v === 0) {
              if (!visited[nr + ',' + nc]) { visited[nr + ',' + nc] = 1; stack.push([nr, nc]); }
            } else borders[v] = 1;
          }
        }
        var borderColors = Object.keys(borders).map(Number);
        if (borderColors.length === 1) territory[borderColors[0]] += region.length;
      }
    }
    var score1 = stones[1] + territory[1];
    var score2 = stones[2] + territory[2] + KOMI;
    var winner = score1 > score2 ? 1 : (score2 > score1 ? 2 : 0);
    return {
      score1: score1, score2: score2, winner: winner,
      territory: territory, stones: stones, komi: KOMI
    };
  }

  function reset(s) { return createState(s.size); }

  global.Go = {
    KOMI: KOMI,
    createState: createState,
    place: place,
    pass: pass,
    group: group,
    autoDead: autoDead,
    score: score,
    reset: reset,
    inBoard: inBoard
  };
})(typeof window !== 'undefined' ? window : globalThis);
