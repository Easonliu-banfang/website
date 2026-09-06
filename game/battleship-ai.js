/* 海战棋 AI —— 经典 hunt/target 算法。
 *  hunt（猎杀）模式：在棋盘上按奇偶格撒网，效率最高（最小船为 2 格）。
 *  target（追猎）模式：一旦命中，沿正交方向延伸，直到击沉再回到猎杀。
 * 局面小（100 格），同步计算即可，无需 Web Worker。
 */
(function (global) {
  'use strict';

  function inBounds(r, c) { return r >= 0 && r < 10 && c >= 0 && c < 10; }

  // 返回玩家 side 下一步应开火的格 {r,c}
  function nextShot(state, side) {
    var fire = state.fire[side];
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // 收集「活动命中」：已命中(2)但所在船尚未被标记击沉(3)。fire 中 3 表示击沉。
    var targets = [];
    function score(r, c) {
      // 与多少「命中」共线（同一行或同一列相邻）——分数高者优先延伸已知船体
      var s = 0;
      for (var d = 0; d < 4; d++) {
        var rr = r + DIRS[d][0], cc = c + DIRS[d][1];
        if (inBounds(rr, cc) && (fire[rr][cc] === 2)) {
          // 若两端都有命中，说明这是船体中间，继续延伸两端更优
          var opp = r - DIRS[d][0], oppc = c - DIRS[d][1];
          if (inBounds(opp, oppc) && fire[opp][oppc] === 2) s += 3;
          else s += 1;
        }
      }
      return s;
    }

    var hasActive = false;
    for (var r = 0; r < 10; r++) {
      for (var c = 0; c < 10; c++) {
        if (fire[r][c] === 2) {
          hasActive = true;
          for (var d = 0; d < 4; d++) {
            var nr = r + DIRS[d][0], nc = c + DIRS[d][1];
            if (inBounds(nr, nc) && fire[nr][nc] === 0) targets.push([nr, nc, score(nr, nc)]);
          }
        }
      }
    }
    if (targets.length) {
      // 取分数最高者（并列随机）
      var best = targets[0], max = targets[0][2];
      for (var i = 1; i < targets.length; i++) if (targets[i][2] > max) { max = targets[i][2]; best = targets[i]; }
      var top = targets.filter(function (t) { return t[2] === max; });
      var pick = top[Math.floor(Math.random() * top.length)];
      return { r: pick[0], c: pick[1] };
    }

    // 猎杀模式：优先奇偶格（覆盖所有长度≥2 的船），其次任意空格
    var parity = [], any = [];
    for (r = 0; r < 10; r++) {
      for (c = 0; c < 10; c++) {
        if (fire[r][c] === 0) {
          if ((r + c) % 2 === 0) parity.push([r, c]);
          else any.push([r, c]);
        }
      }
    }
    var pool = parity.length ? parity : any;
    if (!pool.length) return null;
    var k = Math.floor(Math.random() * pool.length);
    return { r: pool[k][0], c: pool[k][1] };
  }

  global.BattleshipAI = { nextShot: nextShot };
})(typeof window !== 'undefined' ? window : globalThis);
