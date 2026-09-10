/* 八球台球 —— 物理引擎（纯逻辑，无 DOM，可 node 单独测试）
 *
 * 世界单位（米）：球桌内沿 2.0m × 1.0m（标准 9 尺 2:1 比例），球半径 R=0.045m（直径0.09m，约为真实1.6倍便于游玩与观赏）。
 * 物理模型：
 *   1) 固定时间步（默认 1/480s），每帧按真实时间累积、拆成多个子步推进
 *   2) 双模摩擦：滑动摩擦（μs·g）→ 达到滚动条件后切滚动摩擦（μr·g，很小），避免球永远滑行
 *   3) 球-球：弹性碰撞（恢复系数 e + 切向摩擦传递旋转），重叠投影分离
 *   4) 库边：法向恢复 e=0.78，切向摩擦削弱，旋转发散到库边回弹（侧旋）
 *   5) 口袋：6 个（4 角 + 2 侧中点），圆形捕获区，进袋判定（含角袋"卡口"处理）
 *   6) 击球：Cue 的冲量模型 —— dir × power 赋初速，击球点偏移产生 上旋/拉杆(w) 与 侧旋(s)
 */
(function (global) {
  'use strict';

  var PI = Math.PI;
  var TAU = PI * 2;

  var R = 0.045;            // 球半径（m）
  var D = R * 2;            // 球直径
  var TABLE_W = 2.0;        // 内沿宽
  var TABLE_H = 1.0;        // 内沿高

  var CORNER = 0.088;       // 角袋捕获半径（大于球半径，球能"沉入"袋口）
  var SIDE = 0.102;         // 中袋捕获半径（开口略大）

  var G = 9.8;             // 重力加速度（m/s²）
  var MU_S = 0.30;         // 滑动摩擦系数（台呢）
  var MU_R = 0.012;        // 滚动摩擦系数
  var E_BALL = 0.95;       // 球-球恢复系数
  var E_CUSH = 0.80;       // 库边恢复系数
  var MU_CUSH = 0.10;      // 库边切向摩擦

  var SPIN_MAX_W = 60;     // 上/拉杆最大角速度（rad/s）
  var SPIN_MAX_S = 40;     // 侧旋最大（rad/s，绕垂直轴）

  var POCKETS = [
    { x: 0, y: 0, r: CORNER },
    { x: TABLE_W, y: 0, r: CORNER },
    { x: 0, y: TABLE_H, r: CORNER },
    { x: TABLE_W, y: TABLE_H, r: CORNER },
    { x: TABLE_W / 2, y: 0 - 0.0, r: SIDE },
    { x: TABLE_W / 2, y: TABLE_H, r: SIDE }
  ];

  /* ---------- 基础工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function len(x, y) { return Math.sqrt(x * x + y * y); }

  /* ---------- 世界 ---------- */
  function createWorld(seed) {
    return {
      balls: [],            // 有效球（未进袋）
      pocketed: [],         // 已进袋：[{ball, pocketIdx, t}]（t 为入袋时刻 simTime，供规则/动画使用）
      time: 0,              // 累计仿真时间（= simTime）
      simTime: 0,           // 子步级精确时间（每子步推进，事件排序用）
      quiet: true,          // 所有球是否静止（供 UI 判断可操作）
      seed: seed || null,
      cueFirstContactT: null,  // 本杆白球首次碰到目标球的 simTime（击球前由外部重置）
      cueFirstContactType: null,
      railEvents: [],       // 库边碰撞事件 [{t, id}]（击球前由外部清空）
    };
  }

  function makeBall(id, x, y, type) {
    // type: 0=白球, 1..15=彩球编号；1-7 全色，9-15 花色，8 黑八
    return {
      id: id, type: type,
      x: x, y: y,
      vx: 0, vy: 0,
      w: 0,                // 上/拉杆角速度（rad/s，沿运动方向滚动）
      s: 0,                // 侧旋（rad/s，绕垂直轴，>0 右旋）
      r: R, m: 1,
      ghost: false,        // 放置白球时的预览球（不参与碰撞）
    };
  }

  /* 摆球：标准三角架，8 号在第三排中央，两底角一全一花 */
  function rackPositions(footX, footY) {
    var pos = [];
    var row = 0, idx = 0;
    while (idx < 15) {
      for (var i = 0; i <= row && idx < 15; i++, idx++) {
        var x = footX + row * D * Math.cos(PI / 6) * 1.0;
        var y = footY + (i - row / 2) * D;
        pos.push({ x: x, y: y, order: idx });
      }
      row++;
    }
    return pos;
  }

  /* 官方开球摆位：8 号居中，三角底边两角一全色一花色，其余随机 */
  function rackBalls(seed) {
    var pos = rackPositions(TABLE_W * 0.75, TABLE_H / 2); // 脚点，白球在另一端
    var arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    // 洗牌（种子可复现）
    var rnd = mulberry32(seed);
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      swap(arr, i, j);
    }
    // 8 号放第三排中央（索引 6）
    swap(arr, arr.indexOf(8), 6);
    // 底角（索引 0 与 14）：用交换保证互不相同
    var solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
    var cornerA = solids[Math.floor(rnd() * solids.length)];
    var cornerB = stripes[Math.floor(rnd() * stripes.length)];
    swap(arr, arr.indexOf(cornerA), 0);
    swap(arr, arr.indexOf(cornerB), 14);
    // 兜底防错（理论上不会命中；若仍异常则用固定合法排列）
    var vals = new Set(arr);
    if (vals.size !== 15) {
      arr = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
      arr[6] = 8; arr[0] = 1; arr[14] = 15;
    }
    var balls = [];
    for (i = 0; i < pos.length; i++) {
      balls.push(makeBall(arr[i], pos[i].x, pos[i].y, arr[i]));
    }
    return { balls: balls, cue: makeBall(0, TABLE_W * 0.25, TABLE_H / 2, 0), pos: pos };
  }

  function swap(a, i, j) { var t = a[i]; a[i] = a[j]; a[j] = t; }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 摆放进 world：world.balls = 15 + cue */
  function setup(world, rack) {
    world.balls = rack.balls.concat([rack.cue]);
    // 初始随机先手时不额外动作
    return world;
  }

  /* ---------- 一步（多个子步） ---------- */
  var SUB_DT = 1 / 480;

  function step(world, dt, opts) {
    opts = opts || {};
    // 限制单帧子步数，防空转
    var steps = Math.max(1, Math.min(120, Math.ceil(dt / SUB_DT)));
    var h = dt / steps;
    for (var i = 0; i < steps; i++) {
      world.simTime += h;          // 子步前推进精确时间，事件按此刻排序
      stepSub(world, h);
      if (opts.perSub && opts.perSub(world, i, steps)) break;
    }
    world.time = world.simTime;
    // 静止判定
    var any = false;
    for (var b = 0; b < world.balls.length; b++) {
      var ball = world.balls[b];
      if (ball.vx * ball.vx + ball.vy * ball.vy > 1e-9 || Math.abs(ball.w) > 0.5 || Math.abs(ball.s) > 0.5) { any = true; break; }
    }
    world.quiet = !any;
  }

  function stepSub(world, h) {
    var balls = world.balls;
    // 1) 积分 + 摩擦
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.ghost) continue;
      if (b.dead) continue;
      applyFriction(b, h);
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    // 2) 库边
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (b.ghost || b.dead) continue;
      bounceCushion(b, world);
    }
    // 3) 球-球碰撞（两次迭代减少穿透）
    for (var iter = 0; iter < 2; iter++) {
      for (i = 0; i < balls.length; i++) {
        var bi = balls[i];
        if (bi.ghost || bi.dead) continue;
        for (var j = i + 1; j < balls.length; j++) {
          var bj = balls[j];
          if (bj.ghost || bj.dead) continue;
          collideBalls(bi, bj, world);
        }
      }
    }
    // 4) 口袋捕获
    for (i = balls.length - 1; i >= 0; i--) {
      b = balls[i];
      if (b.ghost || b.dead) continue;
      pocketCheck(world, b, i);
    }
  }

  /* 摩擦：滑动 → 滚动 */
  function applyFriction(b, h) {
    var v2 = b.vx * b.vx + b.vy * b.vy;
    var v = Math.sqrt(v2);
    if (v < 1e-6 && Math.abs(b.w) < 1e-3 && Math.abs(b.s) < 1e-3) return;
    if (v < 1e-6) {
      // 原地转：侧旋耗散 + 滚动速率靠摩擦消减（简化：直接衰减）
      b.w *= (1 - 0.5 * h * 4);
      b.s *= (1 - 0.5 * h * 4);
      if (Math.abs(b.w) < 1e-3) b.w = 0;
      if (Math.abs(b.s) < 1e-3) b.s = 0;
      return;
    }
    var ux = b.vx / v, uy = b.vy / v;
    // 滚动条件：v ≈ |w|·R（w 方向与 v 一致为正）
    var rollV = b.w * R;
    var slide = Math.abs(v - rollV) > 0.05 * v + 0.03;
    var dec = slide ? MU_S * G : MU_R * G;
    var dv = dec * h;
    if (dv > v) dv = v;
    b.vx -= ux * dv;
    b.vy -= uy * dv;
    // 旋转耦合：滑动时角速度向滚动条件靠拢
    if (slide) {
      var target = v / R;
      var dw = (target - b.w) * (MU_S * G / R) * h * 0.8;
      b.w += clamp(dw, -target * 2, target * 2);
    } else {
      b.w = v / R;   // 纯滚动：锁定
    }
    // 侧旋（英文）：滑动时侧旋使球轻微侧飘，逐步耗散
    if (Math.abs(b.s) > 1e-3) {
      var lat = 0.10 * b.s * h;   // 侧向加速度（简化模型，让侧旋有真实"拉杆弧线"感）
      b.vx += (-uy) * lat;
      b.vy += ux * lat;
      b.s *= (1 - 0.12 * h * 4);
      if (Math.abs(b.s) < 1e-3) b.s = 0;
    }
    // 绝对停止阈值
    var v3 = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (v3 < 0.008) { b.vx = 0; b.vy = 0; if (Math.abs(b.w) < 0.8) b.w = 0; }
  }

  /* 库边反弹 */
  function bounceCushion(b, world) {
    var x = b.x, y = b.y;
    var bounced = false;
    if (x < R) { bounceAxis(b, 'x', -1, R - x); bounced = true; }
    if (x > TABLE_W - R) { bounceAxis(b, 'x', 1, x - (TABLE_W - R)); bounced = true; }
    if (y < R) { bounceAxis(b, 'y', -1, R - y); bounced = true; }
    if (y > TABLE_H - R) { bounceAxis(b, 'y', 1, y - (TABLE_H - R)); bounced = true; }
    if (bounced) {
      b.vx *= 0.999; b.vy *= 0.999;   // 微小能量损耗
      // 侧旋在库边发生"吃库"变化：简化 —— 侧旋衰减
      b.s *= 0.86;
      if (Math.abs(b.s) < 0.3) b.s = 0;
      // 记录库边事件（规则：开球 4 球碰库、击球后"碰库"判定）
      if (world) world.railEvents.push({ t: world.simTime, id: b.id, type: b.type });
    }
  }

  function bounceAxis(b, axis, sign, pen) {
    if (axis === 'x') {
      if (pen > 0) b.x = (sign < 0 ? R : TABLE_W - R) + sign * 0.001;
      if (Math.abs(b.vx) > 0.02) {
        b.vx = -b.vx * E_CUSH;
      } else {
        b.vx = 0;
      }
      // 切向摩擦：沿库边方向削弱
      b.vy *= (1 - MU_CUSH * 0.5);
    } else {
      if (pen > 0) b.y = (sign < 0 ? R : TABLE_H - R) + sign * 0.001;
      if (Math.abs(b.vy) > 0.02) {
        b.vy = -b.vy * E_CUSH;
      } else {
        b.vy = 0;
      }
      b.vx *= (1 - MU_CUSH * 0.5);
    }
  }

  /* 球-球碰撞（等质量弹性 + 切向摩擦 + 旋转传递） */
  function collideBalls(a, b, world) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var d2 = dx * dx + dy * dy;
    var minD = a.r + b.r;
    if (d2 >= minD * minD || d2 < 1e-12) return;
    // 记录白球首次碰球（规则：先碰给定组球；开球首次接触任意球）
    if (world && world.cueFirstContactT === null && (a.type === 0 || b.type === 0)
        && !a.dead && !b.dead) {
      world.cueFirstContactT = world.simTime;
      world.cueFirstContactType = a.type === 0 ? b.type : a.type;
    }
    var d = Math.sqrt(d2);
    // 投影分离
    var nx = dx / d, ny = dy / d;
    var overlap = (minD - d) * 0.5;
    a.x -= nx * overlap; a.y -= ny * overlap;
    b.x += nx * overlap; b.y += ny * overlap;
    // 相对速度
    var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    var vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      var j = -(1 + E_BALL) * vn * 0.5;      // 等质量：m=1 时 系数 j = -(1+e)vn/2
      a.vx -= nx * j; a.vy -= ny * j;
      b.vx += nx * j; b.vy += ny * j;
      // 切向摩擦（库仑）
      var tx = -ny, ty = nx;
      var vt = rvx * tx + rvy * ty;
      var jt = -vt * 0.5;
      var maxJt = 0.35 * Math.abs(j);
      if (jt > maxJt) jt = maxJt; else if (jt < -maxJt) jt = -maxJt;
      a.vx -= tx * jt; a.vy -= ty * jt;
      b.vx += tx * jt; b.vy += ty * jt;
      // 旋转传递（切向冲量改变自旋，垂直轴 w 简化不传，只传侧旋 s）
      var dS = jt * 2.6;   // 经验系数
      a.s -= dS; b.s += dS;
      if (Math.abs(a.s) > SPIN_MAX_S * 3) a.s = SPIN_MAX_S * 3 * Math.sign(a.s);
      if (Math.abs(b.s) > SPIN_MAX_S * 3) b.s = SPIN_MAX_S * 3 * Math.sign(b.s);
    }
  }

  /* 口袋捕获 */
  function pocketCheck(world, b, idx) {
    for (var p = 0; p < POCKETS.length; p++) {
      var pocket = POCKETS[p];
      var dx = b.x - pocket.x, dy = b.y - pocket.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var capR = pocket.r * 0.94;
      if (d < capR) {
        // 进袋：移除球
        b.dead = true;
        b.pocketIdx = p;
        b.pocketT = world.simTime;
        world.pocketed.push({ ball: b, pocketIdx: p, t: world.simTime, type: b.type });
        world.balls.splice(idx, 1);
        return;
      }
    }
  }

  /* 击球：对白球施加初速与旋转。offset: [0.5..1.5] 力度；topback: -1(拉杆)..1(高杆)；leftright: -1(左塞)..1(右塞) */
  function strike(cue, dirX, dirY, power, topback, leftright) {
    // power 0..MAX_POWER 映射到初速
    var MAX_V = 9.0;
    var v = clamp(power, 0, 1) * MAX_V;
    cue.vx = dirX * v;
    cue.vy = dirY * v;
    cue.w = clamp(topback, -1, 1) * SPIN_MAX_W * (0.5 + 0.5 * v / MAX_V);
    cue.s = clamp(leftright, -1, 1) * SPIN_MAX_S;
  }

  /* 白球落位（球手自由球）：返回是否合法（不与任何球重叠、不出界） */
  function canPlace(world, x, y) {
    if (x < R || x > TABLE_W - R || y < R || y > TABLE_H - R) return false;
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (b.type === 0 || b.dead || b.ghost) continue;
      var dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy < (D * 1.05) * (D * 1.05)) return false;
    }
    return true;
  }

  /* 白球是否"在桌"（未被击入池） */
  function cueAlive(world) {
    for (var i = 0; i < world.balls.length; i++) {
      if (world.balls[i].type === 0) return true;
    }
    return false;
  }

  global.PoolPhys = {
    R: R, D: D, TABLE_W: TABLE_W, TABLE_H: TABLE_H,
    POCKETS: POCKETS,
    createWorld: createWorld,
    makeBall: makeBall,
    setup: setup,
    rackPositions: rackPositions,
    rackBalls: rackBalls,
    step: step,
    strike: strike,
    canPlace: canPlace,
    cueAlive: cueAlive,
  };
})(typeof window !== 'undefined' ? window : globalThis);