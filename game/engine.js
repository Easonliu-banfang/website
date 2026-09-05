/* Quoridor 规则引擎 —— 纯逻辑，不依赖 DOM，可单独测试 */
(function (global) {
  'use strict';

  var N = 9;            // 棋盘 9x9
  var S = 8;            // 墙槽 8x8
  var WALL_COUNT = 10;  // 每人 10 面墙

  function key(r, c) { return r + ',' + c; }

  function createState(walls) {
    var w = typeof walls === 'number' ? walls : WALL_COUNT;
    return {
      players: [
        { r: 8, c: 4, walls: w, goal: 0 },
        { r: 0, c: 4, walls: w, goal: 8 }
      ],
      wallsH: {},
      wallsV: {},
      turn: 0,
      winner: -1,
      history: []
    };
  }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /* 从 (r,c) 走向相邻格 (nr,nc) 是否被墙挡住 */
  function blocked(s, r, c, nr, nc) {
    var dr = nr - r, dc = nc - c;
    if (dr === -1) return !!(s.wallsH[key(r - 1, c)] || s.wallsH[key(r - 1, c - 1)]);
    if (dr === 1)  return !!(s.wallsH[key(r, c)]     || s.wallsH[key(r, c - 1)]);
    if (dc === -1) return !!(s.wallsV[key(r, c - 1)] || s.wallsV[key(r - 1, c - 1)]);
    if (dc === 1)  return !!(s.wallsV[key(r, c)]     || s.wallsV[key(r - 1, c)]);
    return true;
  }

  /* 合法落点：含跳子与斜走 */
  function legalMoves(s, p) {
    var me = s.players[p], foe = s.players[1 - p];
    var out = [], seen = {};
    function add(r, c) {
      var k = key(r, c);
      if (!seen[k]) { seen[k] = 1; out.push({ r: r, c: c }); }
    }
    for (var i = 0; i < 4; i++) {
      var dr = DIRS[i][0], dc = DIRS[i][1];
      var nr = me.r + dr, nc = me.c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      if (blocked(s, me.r, me.c, nr, nc)) continue;

      if (nr === foe.r && nc === foe.c) {
        var jr = nr + dr, jc = nc + dc;
        var canJump = jr >= 0 && jr < N && jc >= 0 && jc < N && !blocked(s, nr, nc, jr, jc);
        if (canJump) {
          add(jr, jc);
        } else {
          var sides = (dr !== 0) ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
          for (var k = 0; k < 2; k++) {
            var sr = nr + sides[k][0], sc = nc + sides[k][1];
            if (sr < 0 || sr >= N || sc < 0 || sc >= N) continue;
            if (blocked(s, nr, nc, sr, sc)) continue;
            add(sr, sc);
          }
        }
      } else {
        add(nr, nc);
      }
    }
    return out;
  }

  /* 是否还有通往底边的路 —— 校验放墙不能封死对手 */
  function hasPath(s, p) {
    var me = s.players[p], goal = me.goal;
    var seen = {}, q = [[me.r, me.c]], head = 0;
    seen[key(me.r, me.c)] = 1;
    while (head < q.length) {
      var cur = q[head++], r = cur[0], c = cur[1];
      if (r === goal) return true;
      for (var i = 0; i < 4; i++) {
        var nr = r + DIRS[i][0], nc = c + DIRS[i][1];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (blocked(s, r, c, nr, nc)) continue;
        var k = key(nr, nc);
        if (seen[k]) continue;
        seen[k] = 1;
        q.push([nr, nc]);
      }
    }
    return false;
  }

  /* 最短路径，path[0] 为首步 —— AI 用 */
  function shortestPath(s, p) {
    var me = s.players[p], goal = me.goal;
    var prev = {}, q = [[me.r, me.c]], head = 0;
    var startKey = key(me.r, me.c);
    prev[startKey] = null;
    var endKey = null;
    while (head < q.length) {
      var cur = q[head++], r = cur[0], c = cur[1];
      if (r === goal) { endKey = key(r, c); break; }
      for (var i = 0; i < 4; i++) {
        var nr = r + DIRS[i][0], nc = c + DIRS[i][1];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (blocked(s, r, c, nr, nc)) continue;
        var k = key(nr, nc);
        if (prev[k] !== undefined) continue;
        prev[k] = key(r, c);
        q.push([nr, nc]);
      }
    }
    if (endKey === null) return null;
    var path = [], k = endKey;
    while (k && k !== startKey) {
      var parts = k.split(',');
      path.unshift({ r: +parts[0], c: +parts[1] });
      k = prev[k];
    }
    return path;
  }

  /* 到终点的最短距离（BFS），把对手所在格视为不可直接踩（跳跃另算）。用于 AI 评估走子/放墙。 */
  function distToGoal(s, p) {
    var me = s.players[p], foe = s.players[1 - p], goal = me.goal;
    var seen = {}, q = [[me.r, me.c]], head = 0;
    seen[key(me.r, me.c)] = 0;
    while (head < q.length) {
      var cur = q[head++], r = cur[0], c = cur[1];
      if (r === goal) return seen[key(r, c)];
      var d = seen[key(r, c)];
      for (var i = 0; i < 4; i++) {
        var nr = r + DIRS[i][0], nc = c + DIRS[i][1];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (blocked(s, r, c, nr, nc)) continue;
        if (nr === foe.r && nc === foe.c) continue;   // 对手所在格不能直接踩，跳跃由 legalMoves 单独处理
        var k = key(nr, nc);
        if (seen[k] !== undefined) continue;
        seen[k] = d + 1;
        q.push([nr, nc]);
      }
    }
    return Infinity;
  }

  /* 墙槽是否已被占用或与邻墙重叠 */
  function wallConflict(s, r, c, dir) {
    if (r < 0 || r >= S || c < 0 || c >= S) return true;
    var k = key(r, c);
    if (s.wallsH[k] || s.wallsV[k]) return true;
    if (dir === 'H') {
      if (c > 0     && s.wallsH[key(r, c - 1)]) return true;
      if (c < S - 1 && s.wallsH[key(r, c + 1)]) return true;
    } else {
      if (r > 0     && s.wallsV[key(r - 1, c)]) return true;
      if (r < S - 1 && s.wallsV[key(r + 1, c)]) return true;
    }
    return false;
  }

  function canPlaceWall(s, r, c, dir) {
    if (wallConflict(s, r, c, dir)) return false;
    var k = key(r, c);
    if (dir === 'H') s.wallsH[k] = 1; else s.wallsV[k] = 1;
    var ok = hasPath(s, 0) && hasPath(s, 1);
    if (dir === 'H') delete s.wallsH[k]; else delete s.wallsV[k];
    return ok;
  }

  function move(s, p, r, c) {
    var legal = legalMoves(s, p);
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].r === r && legal[i].c === c) {
        s.history.push({ type: 'move', p: p, from: [s.players[p].r, s.players[p].c], to: [r, c] });
        s.players[p].r = r;
        s.players[p].c = c;
        if (r === s.players[p].goal) s.winner = p;
        else s.turn = 1 - p;
        return true;
      }
    }
    return false;
  }

  function placeWall(s, p, r, c, dir) {
    if (s.players[p].walls <= 0) return false;
    if (!canPlaceWall(s, r, c, dir)) return false;
    var k = key(r, c);
    if (dir === 'H') s.wallsH[k] = 1; else s.wallsV[k] = 1;
    s.players[p].walls--;
    s.history.push({ type: 'wall', p: p, r: r, c: c, dir: dir });
    s.turn = 1 - p;
    return true;
  }

  function undo(s) {
    var h = s.history.pop();
    if (!h) return false;
    if (h.type === 'move') {
      s.players[h.p].r = h.from[0];
      s.players[h.p].c = h.from[1];
    } else {
      delete s[h.dir === 'H' ? 'wallsH' : 'wallsV'][key(h.r, h.c)];
      s.players[h.p].walls++;
    }
    s.winner = -1;
    s.turn = h.p;
    return true;
  }

  global.Quoridor = {
    N: N, S: S, WALL_COUNT: WALL_COUNT,
    createState: createState,
    clone: clone,
    legalMoves: legalMoves,
    hasPath: hasPath,
    shortestPath: shortestPath,
    distToGoal: distToGoal,
    canPlaceWall: canPlaceWall,
    wallConflict: wallConflict,
    blocked: blocked,
    move: move,
    placeWall: placeWall,
    undo: undo,
    key: key
  };
})(typeof window !== 'undefined' ? window : globalThis);
