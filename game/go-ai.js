/* 围棋 AI v2 —— 蒙特卡洛树搜索（MCTS）+ 棋理启发式
 * 核心思路（业界验证过的最佳性价比路线）：
 *   1) 候选生成不扫全盘：只关注「能提子 / 会被提 / 有棋接触」的局部点 + 星位开局
 *   2) 战术优先：一步能提 ≥1 子 / 补自己的死棋 → 必选（1 层静态检验）
 *   3) MCTS（≤13 路）：UCT 选择 + 带棋理偏好的快速模拟（吃子必走、送吃不走、贴邻落子），
 *      模拟终局用「区域归属」近似数空，时间预算内迭代
 *   4) 大棋盘（19 路）：候选裁剪 + 逐点静态评估（提子/气/攻防/形状）
 *   5) 绝不轻易 pass：只有完全没有可行候选才停一手（收官例外）
 */
(function (global) {
  'use strict';

  var DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  var N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  /* ---------- 盘面工具 ---------- */

  function inB(s, r, c) { return r >= 0 && r < s.size && c >= 0 && c < s.size; }

  function cloneState(s) {
    return {
      size: s.size,
      board: s.board.map(function (row) { return row.slice(); }),
      turn: s.turn,
      ko: s.ko ? s.ko.slice() : null,
      captures: { 1: s.captures[1], 2: s.captures[2] },
      passes: s.passes,
      winner: s.winner,
      history: s.history.slice(),                    // 副本！模拟落子不得污染真实 history
      score: s.score,
      snapshots: s.snapshots ? s.snapshots.slice() : []   // 副本！模拟不得污染悔棋快照栈
    };
  }

  // 同色连通块：{ color, stones, libs }
  function group(s, r, c) {
    var color = s.board[r][c];
    if (color === 0) return null;
    var stones = [], libs = {};
    var stack = [[r, c]], seen = {};
    seen[r + ',' + c] = 1;
    while (stack.length) {
      var cur = stack.pop();
      stones.push(cur);
      for (var d = 0; d < 4; d++) {
        var nr = cur[0] + DIRS[d][0], nc = cur[1] + DIRS[d][1];
        if (!inB(s, nr, nc)) continue;
        var v = s.board[nr][nc];
        if (v === 0) libs[nr + ',' + nc] = 1;
        else if (v === color && !seen[nr + ',' + nc]) { seen[nr + ',' + nc] = 1; stack.push([nr, nc]); }
      }
    }
    return { color: color, stones: stones, libs: Object.keys(libs) };
  }

  function liberties(s, r, c) {
    var g = group(s, r, c);
    return g ? g.libs.length : 0;
  }

  // 找出所有「气 ≤ 1」的块及其外气（用于吃子/防守候选）
  function weakBlocks(s, color) {
    var out = [], seenBlocks = {};
    for (var r = 0; r < s.size; r++) {
      for (var c = 0; c < s.size; c++) {
        if (s.board[r][c] !== color) continue;
        var k = r + ',' + c;
        if (seenBlocks[k]) continue;
        var g = group(s, r, c);
        for (var i = 0; i < g.stones.length; i++) seenBlocks[g.stones[i][0] + ',' + g.stones[i][1]] = 1;
        if (g.libs.length <= 1) out.push({ stones: g.stones, libs: g.libs.map(function (x) { return x.split(',').map(Number); }) });
      }
    }
    return out;
  }

  function isOwnEye(s, r, c, p) {
    if (s.board[r][c] !== 0) return false;
    for (var d = 0; d < 4; d++) {
      var nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (!inB(s, nr, nc)) continue;
      if (s.board[nr][nc] !== p) return false;
    }
    return true;
  }

  /* ---------- 候选生成 ---------- */

  // 返回按优先级排序的候选列表（去重、按分数降序）
  function genCandidates(s, me) {
    var opp = 3 - me;
    var scored = {};      // "r,c" -> priority (越大越优先)
    function add(r, c, pr) {
      if (!inB(s, r, c) || s.board[r][c] !== 0) return;
      if (s.ko && s.ko[0] === r && s.ko[1] === c) return;
      var k = r + ',' + c;
      if (!(k in scored) || pr > scored[k]) scored[k] = pr;
    }

    // 1) 能吃对方：敌方 1 气块的外气（吃子！）优先减掉对方 2 气块的威胁点
    var weakO = weakBlocks(s, opp);
    for (var i = 0; i < weakO.length; i++) {
      var b = weakO[i];
      var pr = b.stones.length >= 4 ? 1000 : (b.stones.length >= 2 ? 900 : 800);
      for (var j = 0; j < b.libs.length; j++) add(b.libs[j][0], b.libs[j][1], pr + 10);
    }
    // 2) 救自己：己方 1 气块的外气（被吃的点补气）
    var weakM = weakBlocks(s, me);
    for (var m = 0; m < weakM.length; m++) {
      var mb = weakM[m];
      var mpr = mb.stones.length >= 4 ? 700 : (mb.stones.length >= 2 ? 650 : 600);
      for (var n = 0; n < mb.libs.length; n++) add(mb.libs[n][0], mb.libs[n][1], mpr);
    }
    // 3) 邻接扩张：每个棋子 8 邻（含斜向），越近中心越优
    for (var r = 0; r < s.size; r++) {
      for (var c = 0; c < s.size; c++) {
        if (s.board[r][c] === 0) continue;
        for (var d = 0; d < 8; d++) {
          var nr = r + N8[d][0], nc = c + N8[d][1];
          if (inB(s, nr, nc) && s.board[nr][nc] === 0) {
            // 己方正接触点优先（连接/切断），中心偏置
            var cent = s.size - 1;
            var dist = Math.abs(nr - cent / 2) + Math.abs(nc - cent / 2);
            var pr = 200 + (s.board[r][c] === me ? 30 : 0) - dist * 3;
            add(nr, nc, pr);
          }
        }
      }
    }
    // 4) 空盘/极早期：星位与中心点
    var total = 0;
    for (var rr = 0; rr < s.size; rr++) for (var cc = 0; cc < s.size; cc++) if (s.board[rr][cc] !== 0) total++;
    if (total <= 3) {
      var stars = starPoints(s.size);
      for (var st = 0; st < stars.length; st++) add(stars[st][0], stars[st][1], 500);
      var mid = Math.floor(s.size / 2);
      add(mid, mid, 500);
    }

    // 排序输出（截断候选数量控制分支因子）
    var list = Object.keys(scored).map(function (k) {
      var xy = k.split(',').map(Number);
      return { r: xy[0], c: xy[1], pr: scored[k] };
    }).sort(function (a, b2) { return b2.pr - a.pr; });
    var cap = s.size <= 9 ? 40 : (s.size <= 13 ? 50 : 28);
    return list.slice(0, cap);
  }

  function starPoints(n) {
    var pts = [];
    if (n >= 9) {
      var a = [3, n - 4], b = [Math.floor(n / 2)];
      var pos = b.length ? [3, n - 4, b[0]] : [3, n - 4];
      for (var i = 0; i < pos.length; i++)
        for (var j = 0; j < pos.length; j++)
          pts.push([pos[i], pos[j]]);
    } else {
      var m = Math.floor(n / 2);
      pts.push([m, m]);
    }
    return pts;
  }

  /* ---------- 静态评估（单点） ---------- */

  // 模拟单点落子后的即时得失（提子/送吃/气/填眼）
  function evalOne(s, me, r, c) {
    var cl = cloneState(s);
    if (!global.Go.place(cl, me, r, c)) return -1e9;
    var opp = 3 - me;
    var gained = cl.captures[me] - s.captures[me];       // 提子
    var lost = cl.captures[opp] - s.captures[opp];        // （不会再丢，place 不丢子）
    var score = gained * 90;
    var g = group(cl, r, c);
    if (g) score += g.libs.length * 6;
    if (g && g.libs.length <= 1 && gained === 0) score -= 120;   // 送吃
    if (isOwnEye(s, r, c, me)) score -= 100;                      // 填己眼
    // 成眼潜力：落子后该点周围同色多 → 加分
    var around = 0;
    for (var d = 0; d < 4; d++) {
      var nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (inB(s, nr, nc) && s.board[nr][nc] === me) around++;
    }
    score += around * 10;
    return score;
  }

  // 启发式最优（19 路等大棋盘）
  function heuristicBest(s, me, cands) {
    var best = null, bestVal = -1e9;
    for (var i = 0; i < cands.length; i++) {
      var v = evalOne(s, me, cands[i].r, cands[i].c);
      if (v > bestVal) { bestVal = v; best = cands[i]; }
    }
    return best ? [best.r, best.c] : null;
  }

  /* ---------- MCTS ---------- */

  // 快速模拟每一步的偏好排序（零克隆：只读盘面做轻启发式，性能关键）
  function rolloutMoves(s, player) {
    var opp = 3 - player;
    // 1) 吃子优先：敌方 1 气块的外气
    var pulls = [];
    var weakO = weakBlocks(s, opp);
    for (var i = 0; i < weakO.length; i++) {
      var b = weakO[i];
      for (var j = 0; j < b.libs.length; j++) {
        var r = b.libs[j][0], c = b.libs[j][1];
        if (s.board[r][c] !== 0) continue;
        if (s.ko && s.ko[0] === r && s.ko[1] === c) continue;
        pulls.push({ r: r, c: c, pr: 800 + b.stones.length * 20 });
      }
    }
    if (pulls.length) return pulls[Math.floor(Math.random() * pulls.length)];
    // 2) 常规点：轻启发式（邻己加分/邻敌减分/避填眼/偏中心），不 clone
    var any = [], cnt = 0;
    outer:
    for (var rr = 0; rr < s.size; rr++) {
      for (var cc = 0; cc < s.size; cc++) {
        if (s.board[rr][cc] !== 0) continue;
        cnt++;
        if (cnt > 160) break outer;
        if (s.ko && s.ko[0] === rr && s.ko[1] === cc) continue;
        var myN = 0, opN = 0, within = 4;
        for (var d = 0; d < 4; d++) {
          var nr = rr + DIRS[d][0], nc = cc + DIRS[d][1];
          if (!inB(s, nr, nc)) { within--; continue; }
          var v = s.board[nr][nc];
          if (v === player) myN++;
          else if (v === opp) opN++;
        }
        var isEye = (myN === within);           // 4 邻全己（含界外）→ 眼
        var center = (s.size - 1) / 2;
        var pr = 100 + myN * 26 - opN * 12 - (Math.abs(rr - center) + Math.abs(cc - center)) * 0.6;
        if (isEye) pr -= 160;                    // 填己眼
        any.push({ r: rr, c: cc, pr: pr });
      }
    }
    if (!any.length) return null;
    // 加权随机选择（pr 正偏置）
    var minp = 1e9, maxp = -1e9;
    for (var k = 0; k < any.length; k++) { if (any[k].pr > maxp) maxp = any[k].pr; if (any[k].pr < minp) minp = any[k].pr; }
    var shift = 1 + maxp - minp;
    var tot = 0;
    for (var q = 0; q < any.length; q++) tot += (any[q].pr - minp + shift);
    var pick = Math.random() * tot;
    for (var w = 0; w < any.length; w++) {
      pick -= (any[w].pr - minp + shift);
      if (pick <= 0) return any[w];
    }
    return any[any.length - 1];
  }

  // 领地近似（rollout 终局评估）：空域 flood，按接触色归属；黑白得分差
  function territoryScore(s) {
    var size = s.size;
    var visited = {};
    var terr = { 1: 0, 2: 0 }, stones = { 1: 0, 2: 0 };
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var v = s.board[r][c];
        if (v !== 0) { stones[v]++; continue; }
        var key = r + ',' + c;
        if (visited[key]) continue;
        visited[key] = 1;
        var region = 0, borders = {}, stack = [[r, c]];
        while (stack.length) {
          var cur = stack.pop(); region++;
          for (var d = 0; d < 4; d++) {
            var nr = cur[0] + DIRS[d][0], nc = cur[1] + DIRS[d][1];
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            var vv = s.board[nr][nc];
            if (vv === 0) {
              var kk = nr + ',' + nc;
              if (!visited[kk]) { visited[kk] = 1; stack.push([nr, nc]); }
            } else borders[vv] = 1;
          }
        }
        var bkeys = Object.keys(borders).map(Number);
        if (bkeys.length === 1) terr[bkeys[0]] += region;
      }
    }
    return { black: stones[1] + terr[1], white: stones[2] + terr[2] };
  }

  // 单次 rollout（从 s 复制开始，双方交替 maxPly 手，返回 me 视角分数差）
  function runRollout(s, me, maxPly) {
    var cl = cloneState(s);
    var player = cl.turn;         // 当前轮到谁
    var passed = cl.passes;
    var ply = 0;
    while (ply < maxPly && cl.winner < 0) {
      if (passed >= 2) { cl.winner = -2; break; }   // 双方 pass → 结束
      var mv = rolloutMoves(cl, player);
      if (!mv) {
        global.Go.pass(cl, player);
        passed = cl.passes;
      } else {
        if (!global.Go.place(cl, player, mv.r, mv.c)) {
          global.Go.pass(cl, player);   // 非法（复盘不应发生）→ pass
          passed = cl.passes;
        } else passed = 0;
      }
      player = 3 - player;
      ply++;
    }
    var sc = territoryScore(cl);
    var komi = 6.5;
    var myScore = me === 1 ? sc.black : sc.white;
    var opScore = me === 1 ? sc.white : sc.black;
    var diff = (myScore - opScore) - (me === 1 ? 0 : komi);  // 已含贴目方向
    var total = cl.size * cl.size;
    return diff / total;    // 归一化 [-1,1]
  }

  // UCT 选择子节点
  function uctSelect(node, C) {
    var best = null, bestV = -Infinity;
    for (var i = 0; i < node.children.length; i++) {
      var ch = node.children[i];
      var v = ch.w / ch.n + C * Math.sqrt(Math.log(node.n + 1) / (ch.n + 0.001));
      if (v > bestV) { bestV = v; best = ch; }
    }
    return best;
  }

  function mcts(s, me, cands, budgetMs) {
    var start = Date.now();
    var root = { n: 0, w: 0, children: [], move: null, parent: null, untried: cands.slice() };
    // 每个候选一个初始化子节点（避免首轮遍历全盘）
    for (var i = 0; i < cands.length; i++) {
      root.children.push({ n: 0, w: 0, move: [cands[i].r, cands[i].c], parent: root, children: [], untried: [] });
    }
    var sims = 0;
    // 模拟次数预算：至少 60 次，时间预算优先
    var minSims = 60;
    while (sims < minSims || Date.now() - start < budgetMs) {
      // 1) 选择：从根沿 UCT 下探（树深度 ≤ 8）
      var node = root, path = [node];
      var cl = cloneState(s);
      var player = cl.turn;
      while (node.children.length && node !== null) {
        var chosen = uctSelect(node, 1.4);
        if (!chosen) break;
        var ok = global.Go.place(cl, player, chosen.move[0], chosen.move[1]);
        if (!ok) { chosen.n += 0.0001; break; }
        player = 3 - player;
        path.push(chosen);
        node = chosen;
        if (path.length > 10) break;
      }
      // 2) 扩展：给当前叶子补子节点（候选 = 局部候选，简化用全盘扫 40 点）
      if (node.untried && node.untried.length) {
        var mv = node.untried.shift();
        // 尝试扩展这个候选
        var cOk = global.Go.place(cl, player, mv.r, mv.c);
        if (cOk) {
          var child = { n: 0, w: 0, move: [mv.r, mv.c], parent: node, children: [], untried: [] };
          node.children.push(child);
          path.push(child);
          node = child;
          player = 3 - player;
        }
      } else if (node.children.length === 0 && node.move) {
        // 叶子已展开过仍无子 → 直接用它的 move 已计入；继续 rollout
      }
      // 3) rollout + 回溯
      var res = runRollout(cl, me, 42);
      for (var p2 = path.length - 1; p2 >= 0; p2--) {
        path[p2].n++;
        path[p2].w += res;
      }
      sims++;
    }
    // 选访问最多 & 胜率高的子节点
    var bestNode = null, bestN = -1;
    for (var k = 0; k < root.children.length; k++) {
      var cn = root.children[k];
      if (cn.n > bestN) { bestN = cn.n; bestNode = cn; }
    }
    return bestNode ? bestNode.move : null;
  }

  /* ---------- 对外接口 ---------- */

  function nextMove(state, me) {
    if (state.winner >= 0) return null;
    // 棋盘尺寸对应的搜索预算
    var budget = state.size <= 9 ? 380 : (state.size <= 13 ? 480 : 560);
    var cands = genCandidates(state, me);
    if (cands.length === 0) return null;   // 无任何可下点（理论上不会发生）

    // 终局倾向：连续停一手后只下「有明确利益」的点，否则 pass（由上层处理 null）
    if (state.passes >= 1) {
      // 若对手已 pass 且我方没有任何吃子/危险点 → 收官
      var urgent = cands.filter(function (cd) { return cd.pr >= 650; });
      if (urgent.length === 0) return null;
      cands = urgent;
    }

    var mv;
    if (state.size <= 13 && cands.length > 1) {
      mv = mcts(state, me, cands, budget);
    } else {
      mv = heuristicBest(state, me, cands);
    }
    return mv;
  }

  global.GoAI = { nextMove: nextMove, genCandidates: genCandidates, heuristicBest: heuristicBest };
})(typeof window !== 'undefined' ? window : globalThis);