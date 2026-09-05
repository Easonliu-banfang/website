/* Quoridor AI —— Minimax + Alpha-Beta + 迭代加深 + 时间预算
 *
 * 设计要点（来自公开战术研究共识）：
 *  1. 评估函数只用一条核心指标：score = (对手最短路) − (我方最短路)。
 *     这天然让 AI 既会自己冲刺，也会用墙拖慢对手，而不是囤墙或短视贪心。
 *  2. 用 Minimax 对方对抗视角搜索，并加 Alpha-Beta 剪枝，让 AI「多想几步」。
 *  3. 迭代加深 + 时间预算：固定思考时间（如 900ms），逐层加深，时间到就用上一层已完成的最佳着法，
 *     既保证「不会卡死/不会超时」，又能在更快的机器上自动变强。
 *  4. 着法排序（Move Ordering）：优先尝试「能赢的走子 / 截断对手最短路的墙 / 离终点更近的走子」，
 *     极大提升 Alpha-Beta 剪枝效率，从而能搜得更深。
 *
 * 与旧版（单步贪心，只在对手领先≥2 时才放墙、权重仅 0.2）相比：
 *   - 旧版是 1-ply 短视，不会预判对手下一步，所以经常会「降智」。
 *   - 本版是对抗式搜索，能预判对手反击并做出最优权衡。
 */
(function (global) {
  'use strict';

  var Q = global.Quoridor;
  var S = Q.S;      // 墙槽 8x8
  var N = Q.N;      // 棋盘 9x9

  // ---- 可调参数 ----
  var TIME_BUDGET_MS = 900;   // 每步思考上限（毫秒）——「让 AI 多思考」
  var MAX_DEPTH = 7;          // 迭代加深的最大层数（上限保护）
  var MAX_WALL_CANDIDATES = 12; // 每个节点最多考虑的墙候选数（控制分支）
  var WALL_RADIUS = 2;        // 墙候选围绕对手/自身的搜索半径（格）
  var WIN_SCORE = 100000;     // 胜负分（远大于任何路差）

  // ---- 内部状态 ----
  var deadline = 0;
  var nodes = 0;
  var TIME_UP = { __up: true };

  // 最短步数（含跳子/斜走）。无路返回 Infinity。
  function dist(s, p) {
    var path = Q.shortestPath(s, p);
    return path ? path.length : Infinity;
  }

  // 叶子评估（非终局）：从「当前行动方 s.turn」视角返回分数，越高越好（negamax 约定）。
  // 仅在 depth 耗尽、尚未分出胜负时调用；终局由 search 顶部单独处理。
  function leafEval(s, ply) {
    var me = s.turn;
    var myD = dist(s, me);
    var foeD = dist(s, 1 - me);
    // 核心项：对手路更长 / 我方路更短 → 分数更高
    var score = (foeD - myD);
    // 极小的墙数优势项（避免囤墙：权重很小，主要由路差主导）
    score += (s.players[me].walls - s.players[1 - me].walls) * 0.1;
    return score;
  }

  // 某面墙是否截断「从 a 到相邻 b」这条边（用于着法排序）
  function wallBlocksEdge(s, w, a, b) {
    var k = Q.key(w.r, w.c);
    if (w.dir === 'H') s.wallsH[k] = 1; else s.wallsV[k] = 1;
    var blocked = Q.blocked(s, a.r, a.c, b.r, b.c);
    if (w.dir === 'H') delete s.wallsH[k]; else delete s.wallsV[k];
    return blocked;
  }

  // 生成某玩家所有候选着法（走子 + 受限的墙候选）
  function genMoves(s) {
    var p = s.turn;
    var out = [];
    // 走子：直接用引擎合法走法（已含跳子/斜走）
    var lm = Q.legalMoves(s, p);
    for (var i = 0; i < lm.length; i++) {
      out.push({ type: 'move', r: lm[i].r, c: lm[i].c });
    }
    // 墙：仅当还有墙且可放时进行候选生成（位置合法性由 placeWall 在展开时校验）
    if (s.players[p].walls > 0) {
      var foe = s.players[1 - p];
      var me = s.players[p];
      var seen = {};
      var R = WALL_RADIUS;
      var regions = [
        [Math.max(0, foe.r - R), Math.min(S - 1, foe.r + R),
         Math.max(0, foe.c - R), Math.min(S - 1, foe.c + R)],
        [Math.max(0, me.r - 1), Math.min(S - 1, me.r + 1),
         Math.max(0, me.c - 1), Math.min(S - 1, me.c + 1)]
      ];
      var wallCands = [];
      function tryW(r, c, dir) {
        if (r < 0 || r >= S || c < 0 || c >= S) return;
        var key = r + ',' + c + dir;
        if (seen[key]) return;
        seen[key] = 1;
        if (Q.wallConflict(s, r, c, dir)) return; // 已占用/与邻墙重叠 → 跳过
        wallCands.push({ type: 'wall', r: r, c: c, dir: dir });
      }
      for (var z = 0; z < regions.length; z++) {
        var a = regions[z];
        for (var r = a[0]; r <= a[1]; r++) {
          for (var c = a[2]; c <= a[3]; c++) {
            tryW(r, c, 'H');
            tryW(r, c, 'V');
          }
        }
      }
      // 按「快速价值」排序并截断到上限，控制分支因子，使深度 6 能在预算内完成
      wallCands.sort(function (x, y) { return wallQuickScore(s, y, p) - wallQuickScore(s, x, p); });
      for (var wi = 0; wi < wallCands.length && wi < MAX_WALL_CANDIDATES; wi++) {
        out.push(wallCands[wi]);
      }
    }
    return out;
  }

  // 一面墙的「快速价值」（不跑 BFS，只做几何估计）：越靠近对手、朝向越对，分越高
  function wallQuickScore(s, w, p) {
    var foe = s.players[1 - p];
    var wr = w.dir === 'H' ? w.r + 0.5 : w.r;
    var wc = w.dir === 'H' ? w.c + 0.5 : w.c + 0.5;
    var d = Math.abs(wr - foe.r) + Math.abs(wc - foe.c);
    var score = -d;
    // 对手若需要改变行数才能到达终点，横墙(H)更克制；否则竖墙(V)更克制
    if (foe.goal !== foe.r) { if (w.dir === 'H') score += 3; }
    else { if (w.dir === 'V') score += 3; }
    return score;
  }

  // 着法排序：把「更强」的着法放前面，提升 Alpha-Beta 剪枝效率
  function orderMoves(s, moves) {
    var p = s.turn;
    var foe = 1 - p;
    var goal = s.players[p].goal;
    // 预计算对手最短路，用于判断墙是否截断它
    var foePath = Q.shortestPath(s, foe);

    function q(m) {
      if (m.type === 'move') {
        if (m.r === goal) return 1000;            // 直接取胜，最高优先
        return 100 - Math.abs(m.r - goal);        // 离终点行越近越好
      }
      // 墙：基础几何分
      var sc = wallQuickScore(s, m, p);
      // 若该墙截断对手当前最短路，强烈优先
      if (foePath && foePath.length) {
        var hit = false;
        var prev = { r: s.players[foe].r, c: s.players[foe].c };
        for (var i = 0; i < foePath.length && !hit; i++) {
          var cur = foePath[i];
          if (wallBlocksEdge(s, m, prev, cur)) hit = true;
          prev = cur;
        }
        if (hit) sc += 20;
      }
      return sc;
    }

    moves.sort(function (a, b) { return q(b) - q(a); });
  }

  function sameMove(a, b) {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.type === 'move') return a.r === b.r && a.c === b.c;
    return a.r === b.r && a.c === b.c && a.dir === b.dir;
  }

  // 递归极小化极大搜索（带 Alpha-Beta）。视角始终相对当前行动方 s.turn（negamax）。
  function search(s, ply, depth, alpha, beta) {
    // 终局：engine.move 在制胜时不翻转回合，故此时 s.turn 仍是刚取胜的一方。
    // 这里统一按「败方（下一手行动者）」视角返回 -WIN+ply，使 negamax 取反后
    // 父节点拿到正确的「+WIN」——这是修复「制胜步被当成最坏着法」的关键。
    if (s.winner >= 0) return -WIN_SCORE + ply;
    if (depth <= 0) return leafEval(s, ply);
    if ((++nodes & 511) === 0 && Date.now() > deadline) throw TIME_UP;

    var moves = genMoves(s);
    if (moves.length === 0) return leafEval(s, ply);
    orderMoves(s, moves);

    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var ok = (m.type === 'move')
        ? Q.move(s, s.turn, m.r, m.c)
        : Q.placeWall(s, s.turn, m.r, m.c, m.dir);
      if (!ok) continue;
      var score = -search(s, ply + 1, depth - 1, -beta, -alpha);
      Q.undo(s);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // 剪枝
    }
    return best;
  }

  // 根节点搜索：返回本层最佳着法及分数（支持 PV 优先）
  function rootSearch(s, depth, pv) {
    var moves = genMoves(s);
    if (moves.length === 0) return null;
    orderMoves(s, moves);
    // 把上一层最佳着法提到最前
    if (pv) {
      for (var z = 0; z < moves.length; z++) {
        if (sameMove(moves[z], pv)) {
          var tmp = moves.splice(z, 1)[0];
          moves.unshift(tmp);
          break;
        }
      }
    }

    var bestMove = moves[0];
    var bestScore = -Infinity;
    var alpha = -Infinity, beta = Infinity;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var ok = (m.type === 'move')
        ? Q.move(s, s.turn, m.r, m.c)
        : Q.placeWall(s, s.turn, m.r, m.c, m.dir);
      if (!ok) continue;
      var score = -search(s, 1, depth - 1, -beta, -alpha);
      Q.undo(s);
      if (Date.now() > deadline) break; // 时间到：保留当前已找到的最佳
      if (score > bestScore) { bestScore = score; bestMove = m; }
      if (bestScore > alpha) alpha = bestScore;
    }
    return { move: bestMove, score: bestScore };
  }

  // 主入口：迭代加深，时间到即用上一层结果。
  // state.turn 必须是「轮到 AI 行动」的一方；ai 仅用于语义说明/校验。
  function bestMove(state, ai, opts) {
    opts = opts || {};
    var timeBudget = opts.timeBudget || TIME_BUDGET_MS;
    var maxDepth = opts.maxDepth || MAX_DEPTH;
    var root = Q.clone(state);
    deadline = Date.now() + timeBudget;
    nodes = 0;
    var pv = null;
    var result = null;

    try {
      for (var d = 1; d <= maxDepth; d++) {
        var res = rootSearch(root, d, pv);
        if (res && res.move) {
          result = res;
          pv = res.move;
        }
        if (Date.now() > deadline) break;
        // 已找到必胜/必败的确定性着法，无需再深搜
        if (result && Math.abs(result.score) >= WIN_SCORE - 100) break;
      }
    } catch (e) {
      if (e !== TIME_UP) throw e; // 时间到触发的提前退出，属正常
    }

    if (result && result.move) return result.move;
    // 兜底：随便走个合法着法
    var fb = genMoves(root);
    return fb.length ? fb[0] : null;
  }

  global.QuoridorAI = {
    bestMove: bestMove,
    // 暴露内部以便测试/调参
    _setParams: function (o) {
      if (o.timeBudget != null) TIME_BUDGET_MS = o.timeBudget;
      if (o.maxDepth != null) MAX_DEPTH = o.maxDepth;
      if (o.maxWallCandidates != null) MAX_WALL_CANDIDATES = o.maxWallCandidates;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
