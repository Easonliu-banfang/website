/* 八球台球 —— AI 决策（纯逻辑，可 node 测试）
 *
 * 策略：逐目标球 × 逐口袋，用"虚球"瞄准法计算击球几何；检查 白球→目标、目标→袋口 两条路径是否被挡；
 * 按 切角小、力度适中、路径短 评分取最优。完全无球路时退化为安全杆（轻碰最近目标球，随缘贴库）。
 * 支持自由球：先枚举若干可放落点，取球路最优者。
 */
(function (global) {
  'use strict';

  function findBall(world, type) {
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (!b.dead && !b.ghost && b.type === type) return b;
    }
    return null;
  }

  /* 线段是否被球阻挡（ignore 排除目标球） */
  function segBlocked(x0, y0, x1, y1, balls, ignoreId) {
    var dx = x1 - x0, dy = y1 - y0;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return false;
    var P = global.PoolPhys;
    var minGap = P.R * 2 - 0.004;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.dead || b.ghost || b.id !== undefined && b.id === ignoreId) continue;
      var t = ((b.x - x0) * dx + (b.y - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      var cx = x0 + t * dx, cy = y0 + t * dy;
      var d2 = (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy);
      if (d2 < minGap * minGap) return true;
    }
    return false;
  }

  /* 当前击球方合法目标类型 */
  function legalTargetTypes(world, match, me) {
    if (global.PoolRules) return global.PoolRules.legalTargets(match, world);
    var g = match.groups[me];
    var onTable = [];
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (b.dead || b.type === 0) continue;
      onTable.push(b.type);
    }
    if (!g) return onTable.filter(function (t) { return t !== 8; });
    var own = onTable.filter(function (t) { return PoolRulesGroup(t) === g; });
    return own.length ? own : [8];
  }
  function PoolRulesGroup(t) {
    if (t >= 1 && t <= 7) return 'solid';
    if (t >= 9 && t <= 15) return 'stripe';
    return null;
  }

  /* 沿白球出球射线，第一个被碰到的球（白球中心线 2R 内；余量取略大于 2R 悲观过滤，防止贴边错组球逃过校验） */
  function firstBallOnRay(world, x, y, ax, ay) {
    var P = global.PoolPhys;
    var best = null, bestD = 1e9;
    var lim = P.R * 2 + 0.006;
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (b.dead || b.ghost) continue;
      var dx = b.x - x, dy = b.y - y;
      var proj = dx * ax + dy * ay;
      if (proj < 0) continue;
      var perp2 = dx * dx + dy * dy - proj * proj;
      if (perp2 < lim * lim && proj < bestD) { bestD = proj; best = b; }
    }
    return best;
  }

  function isLegalTarget(targets, type) {
    for (var i = 0; i < targets.length; i++) if (targets[i] === type) return true;
    return false;
  }

  /* 死贴目标中心直打是否首碰合法（安全杆用） */
  function safetyAimLegal(world, targets, cx, cy, tx, ty) {
    var dx = tx - cx, dy = ty - cy;
    var d = Math.hypot(dx, dy) || 1;
    var ax = dx / d, ay = dy / d;
    var first = firstBallOnRay(world, cx, cy, ax, ay);
    return !first || isLegalTarget(targets, first.type);
  }

  /* 从 (cx,cy) 出发对每个目标×袋口计算击球，返回最优（要求首碰球为合法目标） */
  function computeShot(world, match, me, cx, cy, targets) {
    var P = global.PoolPhys;
    var balls = world.balls;
    var pockets = P.POCKETS;
    var R = P.R;
    var best = null;
    for (var ti = 0; ti < targets.length; ti++) {
      var target = findBall(world, targets[ti]);
      if (!target) continue;
      for (var pi = 0; pi < pockets.length; pi++) {
        var pk = pockets[pi];
        var dPx = pk.x - target.x, dPy = pk.y - target.y;
        var dP = Math.hypot(dPx, dPy);
        if (dP < 1e-6) continue;
        var ux = dPx / dP, uy = dPy / dP;
        var gx = target.x - ux * R * 2, gy = target.y - uy * R * 2;
        if (gx < R || gx > P.TABLE_W - R || gy < R || gy > P.TABLE_H - R) continue;
        var dd = Math.hypot(gx - cx, gy - cy);
        if (dd < 1e-6) continue;
        var ax = (gx - cx) / dd, ay = (gy - cy) / dd;
        var cut = Math.acos(Math.max(-1, Math.min(1, ax * ux + ay * uy)));
        if (cut > 1.15) continue;                       // 切角过陡
        if (segBlocked(cx, cy, gx, gy, balls, target.id)) continue;    // 白球路径有阻挡
        var blockedPocket = segBlocked(target.x, target.y, pk.x, pk.y, balls, target.id);
        if (blockedPocket) continue;                    // 目标→袋口被挡
        // 首碰球必须是合法目标（否则犯规；开球除外——开球在 app/AI 特判中处理）
        var first = firstBallOnRay(world, cx, cy, ax, ay);
        if (first && !isLegalTarget(targets, first.type)) continue;
        var power = 0.42 + Math.min(0.6, (dd + dP) / 2.0) * 1.05;
        power = Math.max(0.34, Math.min(0.98, power));
        var score = 100 - cut * 150 - Math.abs(power - 0.6) * 70 - (dd + dP) * 5;
        var cand = { type: targets[ti], pocket: pi, cut: cut, power: power, score: score, aimX: ax, aimY: ay };
        if (!best || score > best.score) best = cand;
      }
    }
    return best;
  }

  /* 自由球落点：枚举候选点，取球路得分最高者 */
  function pickSpot(world, match, me) {
    var P = global.PoolPhys;
    if (!P) return { x: 0.4, y: 0.5 };
    var spots = [
      [0.5, 0.5], [0.5, 0.26], [0.5, 0.74], [0.34, 0.5], [0.66, 0.5],
      [0.42, 0.3], [0.58, 0.7], [0.42, 0.7], [0.58, 0.3], [0.3, 0.4], [0.7, 0.6]
    ];
    var targets = legalTargetTypes(world, match, me);
    var best = null, bestScore = -1e9;
    for (var i = 0; i < spots.length; i++) {
      var x = spots[i][0] * P.TABLE_W, y = spots[i][1] * P.TABLE_H;
      if (!P.canPlace(world, x, y)) continue;
      var shot = computeShot(world, match, me, x, y, targets);
      var score = shot ? shot.score : -80;
      if (score > bestScore) { bestScore = score; best = { x: x, y: y, shot: shot }; }
    }
    if (!best) return { x: P.TABLE_W * 0.3, y: P.TABLE_H * 0.5, shot: null };
    return best;
  }

  /* 决策入口：返回 { place:{x,y}|null, shot:{aimX,aimY,power,top,side,pocket}|null } */
  function decide(world, match, me, opts) {
    opts = opts || {};
    var rnd = opts.rnd || Math.random;
    var P = global.PoolPhys;
    var hand = !!(match.hand && match.hand.forPlayer === me && !match.needsChoose);
    var targets = legalTargetTypes(world, match, me);
    var cx, cy, shot;

    if (hand) {
      var ps = pickSpot(world, match, me);
      cx = ps.x; cy = ps.y; shot = ps.shot;
    } else {
      var cue = findBall(world, 0);
      if (!cue) return { place: null, shot: null };
      cx = cue.x; cy = cue.y;
      shot = computeShot(world, match, me, cx, cy, targets);
    }

    // 开球特判：球堆密集导致虚球路径全被"挡"，直接正对最近的球堆顶点重杆开球
    if (match.isBreak && !hand && (!match.groups[0] && !match.groups[1])) {
      var nb = nearestTarget(world, targets, cx, cy);
      if (nb) {
        var ddx = nb.x - cx, ddy = nb.y - cy;
        var ddn = Math.hypot(ddx, ddy) || 1;
        shot = { aimX: ddx / ddn, aimY: ddy / ddn, power: 0.98, top: 0.6, side: 0, pocket: -1, break: true };
      }
    }

    // 完全没球路 → 安全杆：找最近且"直瞄首碰合法"的目标轻碰
    if (!shot) {
      var sorted = targets.slice().sort(function (a, b) {
        var ba = findBall(world, a), bb = findBall(world, b);
        var da = ba ? Math.hypot(ba.x - cx, ba.y - cy) : 1e9;
        var db = bb ? Math.hypot(bb.x - cx, bb.y - cy) : 1e9;
        return da - db;
      });
      var nb = null;
      for (var si = 0; si < sorted.length; si++) {
        var cand = findBall(world, sorted[si]);
        if (!cand) continue;
        if (safetyAimLegal(world, targets, cx, cy, cand.x, cand.y)) { nb = cand; break; }
      }
      if (!nb) nb = nearestTarget(world, targets, cx, cy);
      if (!nb) return { place: hand ? { x: cx, y: cy } : null, shot: null };
      var dx = nb.x - cx, dy = nb.y - cy;
      var d = Math.hypot(dx, dy) || 1;
      shot = { aimX: dx / d, aimY: dy / d, power: 0.34, top: 0.2, side: 0, pocket: -1, safety: true };
    }

    // 微小的瞄准散布（拟人化，避免 AI 杆杆精准）
    var rot = rotate(shot.aimX, shot.aimY, (rnd() - 0.5) * 0.014 + (opts.spread || 0));
    shot.aimX = rot.x; shot.aimY = rot.y;
    if (!shot.safety) shot.power = Math.max(0.25, shot.power + (rnd() - 0.5) * 0.05);
    return { place: hand ? { x: cx, y: cy } : null, shot: shot };
  }

  function nearestTarget(world, targets, cx, cy) {
    var best = null, bd = 1e9;
    for (var i = 0; i < targets.length; i++) {
      var b = findBall(world, targets[i]);
      if (!b) continue;
      var d = Math.hypot(b.x - cx, b.y - cy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function rotate(x, y, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  global.PoolAI = {
    decide: decide,
    legalTargetTypes: legalTargetTypes,
    computeShot: computeShot,
    pickSpot: pickSpot,
  };
})(typeof window !== 'undefined' ? window : globalThis);