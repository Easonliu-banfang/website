/* 八球台球 —— Canvas 渲染器（现代化深色球桌 + 立体球体 + 瞄准辅助）
 *
 * 绘制内容：
 *   背景：深蓝夜色渐变 + 光晕；球桌：木纹外框 + 金属包角 + 深青绿色毛毡 + 橡胶库边；
 *   六袋（角袋/中袋带内阴影）；球：全色/花色/黑八 立体渐变 + 高光 + 编号，白球带高光；
 *   运动球带拖尾光痕；白球瞄准线 + 可行目标高亮；球杆随力度后拉；自由球落位预览（绿/红）。
 */
(function (global) {
  'use strict';

  var BALL_COLORS = {
    1: '#f8c742', 2: '#2f6ff7', 3: '#e63946', 4: '#8b5cf6', 5: '#f97316',
    6: '#22c55e', 7: '#b45309', 8: '#1c2733', 9: '#f8c742', 10: '#2f6ff7',
    11: '#e63946', 12: '#8b5cf6', 13: '#f97316', 14: '#22c55e', 15: '#b45309'
  };
  var SOLID_7 = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 };

  function PoolRender(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 300; this.h = 300;
    this.scale = 1;           // 世界→画布
    this.ox = 0; this.oy = 0; // 世界原点在画布偏移
    this.P = (typeof window !== 'undefined' && window.PoolPhys) ? window.PoolPhys : null;
  }

  PoolRender.prototype.resize = function () {
    var c = this.canvas;
    var parent = c.parentElement;
    var cw = parent ? parent.clientWidth : 640;
    if (cw < 200) cw = 640;
    var ratio = this.P ? (this.P.TABLE_H + 0.5) / (this.P.TABLE_W + 0.5) : 0.55;
    var cssH = Math.max(180, cw * ratio);
    c.style.width = cw + 'px';
    c.style.height = cssH + 'px';
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // 限制超高 DPR 以保证性能
    dpr = Math.min(dpr, 2);
    c.width = Math.round(cw * dpr);
    c.height = Math.round(cssH * dpr);
    this.w = c.width; this.h = c.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = cw; this.cssH = cssH;
    this._layout();
  };

  PoolRender.prototype._layout = function () {
    if (!this.P) return;
    var pad = 60;
    var sx = (this.cssW - pad * 2) / this.P.TABLE_W;
    var sy = (this.cssH - pad * 2) / this.P.TABLE_H;
    this.scale = Math.min(sx, sy);
    this.ox = (this.cssW - this.P.TABLE_W * this.scale) / 2;
    this.oy = (this.cssH - this.P.TABLE_H * this.scale) / 2;
  };

  PoolRender.prototype._px = function (x, y) { return [this.ox + x * this.scale, this.oy + y * this.scale]; };
  PoolRender.prototype._r = function (r) { return r * this.scale; };

  /* 主绘制 */
  PoolRender.prototype.draw = function (data) {
    var g = this.ctx;
    var state = data.state;      // {world, match, ui}
    var world = state.world, ui = state.ui || {}, match = state.match;
    this._drawBackdrop(g);

    // 球桌
    this._drawTable(g, ui);

    // 规则相关高亮（自由球落位、报袋）
    if (ui.placing) this._drawPlacement(g, ui.placing, ui.placeOK);
    if (ui.callPocket !== undefined && ui.callPocket !== null) this._drawCallPocket(g, ui.callPocket, Date.now());

    // 球杆画在球层之下（杆尖被白球遮住 = 真实的"贴球"感）
    if (ui.aim) this._drawCue(g, ui);

    // 球
    this._drawBalls(g, world, ui);

    // 瞄准虚线（球层之上，指向鼠标）
    if (ui.aim) this._drawAim(g, world, ui);
    this._drawHUD(g, ui);
  };

  /* 力度 / 旋转 HUD + 蓄力环 */
  PoolRender.prototype._drawHUD = function (g, ui) {
    var P = this.P;
    // 左上角面板
    g.save();
    g.font = '600 12px "SF Pro Rounded", system-ui, sans-serif';
    g.textBaseline = 'middle';
    var px0 = 16, py0 = 16;
    g.fillStyle = 'rgba(8,14,24,0.62)';
    g.beginPath();
    g.roundRect ? g.roundRect(px0, py0, 176, 54, 10) : g.rect(px0, py0, 176, 54);
    g.fill();
    g.strokeStyle = 'rgba(34,211,238,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect ? g.roundRect(px0, py0, 176, 54, 10) : g.rect(px0, py0, 176, 54);
    g.stroke();
    g.fillStyle = 'rgba(226,232,240,0.9)';
    g.fillText('力度 ' + Math.round((ui.power || 0) * 100) + '%', px0 + 12, py0 + 14);
    // 力度条
    var bw = 120, bx = px0 + 12, by = py0 + 26;
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(bx, by, bw, 7);
    var pw = (ui.power || 0) * bw;
    var pg = g.createLinearGradient(bx, by, bx + bw, by);
    pg.addColorStop(0, '#22d3ee');
    pg.addColorStop(1, '#f59e0b');
    g.fillStyle = pg;
    if (pw > 0) g.fillRect(bx, by, pw, 7);
    g.fillStyle = 'rgba(148,163,184,0.9)';
    g.font = '600 11.5px "SF Pro Rounded", system-ui, sans-serif';
    g.fillText('高/低杆 ' + Math.round(((ui.top === undefined ? 0 : ui.top) + 1) * 50) + '%' +
      '  侧塞 ' + (ui.side > 0.05 ? '右' : (ui.side < -0.05 ? '左' : '中')), px0 + 12, py0 + 42);
    g.restore();

    // 蓄力环（围绕白球）
    if (ui.charging && ui.aim) {
      var world = ui._world;
      var cue = null;
      for (var i = 0; i < world.balls.length; i++) if (world.balls[i].type === 0 && !world.balls[i].dead) { cue = world.balls[i]; break; }
      if (cue) {
        var cx = this.ox + cue.x * this.scale, cy = this.oy + cue.y * this.scale;
        var pr = cue.r * this.scale + 8 + (ui.power || 0) * 16;
        g.save();
        g.strokeStyle = 'rgba(34,211,238,0.85)';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, pr, -Math.PI / 2, -Math.PI / 2 + (ui.power || 0) * Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }
  };

  PoolRender.prototype._drawBackdrop = function (g) {
    var w = this.cssW, h = this.cssH;
    var bg = g.createRadialGradient(w / 2, h * 0.42, 40, w / 2, h * 0.45, Math.max(w, h) * 0.9);
    bg.addColorStop(0, '#12233c');
    bg.addColorStop(0.55, '#0b1526');
    bg.addColorStop(1, '#05080f');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // 环境光晕（青）
    var glow = g.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.62);
    glow.addColorStop(0, 'rgba(34,211,238,0.05)');
    glow.addColorStop(1, 'rgba(34,211,238,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  };

  PoolRender.prototype._drawTable = function (g, ui) {
    var P = this.P, sc = this.scale;
    var W = P.TABLE_W * sc, H = P.TABLE_H * sc;
    var ox = this.ox, oy = this.oy;

    // 桌面投影（桌下深色光晕）
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 34;
    g.shadowOffsetY = 14;
    roundRect(g, ox - 20, oy - 18, W + 40, H + 36, 28);
    g.fillStyle = 'rgba(8,12,20,0.0001)';
    g.fill();
    g.restore();

    // 外层木板（深胡桃木渐变）
    var fx = ox - 30, fy = oy - 28, fw = W + 60, fh = H + 56;
    var wood = g.createLinearGradient(fx, fy, fx + fw, fy + fh);
    wood.addColorStop(0, '#7a5630');
    wood.addColorStop(0.28, '#5d3d1e');
    wood.addColorStop(0.6, '#4a2f15');
    wood.addColorStop(1, '#38220c');
    g.fillStyle = wood;
    roundRect(g, fx, fy, fw, fh, 26);
    g.fill();
    // 木纹细节（横向细纹）
    g.save();
    roundRect(g, fx, fy, fw, fh, 26);
    g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    for (var wl = 0; wl < 9; wl++) {
      var wy = fy + 8 + wl * (fh - 16) / 8 + (wl % 2) * 4;
      g.beginPath(); g.moveTo(fx, wy); g.lineTo(fx + fw, wy); g.stroke();
    }
    g.restore();
    // 边框高光（上缘受光）
    g.strokeStyle = 'rgba(255,214,150,0.25)';
    g.lineWidth = 2;
    roundRect(g, fx + 1.5, fy + 1.5, fw - 3, fh - 3, 26);
    g.stroke();

    // 内侧装饰条（金属/浅木）
    var ix = fx + 13, iy = fy + 13, iw = fw - 26, ih = fh - 26;
    var band = g.createLinearGradient(ix, iy, ix, iy + ih);
    band.addColorStop(0, '#8a6a44');
    band.addColorStop(0.5, '#6b4a2a');
    band.addColorStop(1, '#4c3218');
    g.fillStyle = band;
    roundRect(g, ix, iy, iw, ih, 17);
    g.fill();

    // 橡胶库边（带立体感：暗边 + 顶部受光面）
    var bx = ox - 9, by = oy - 12, bw = W + 18, bh = H + 24;
    var rubber = g.createLinearGradient(bx, by, bx, by + bh);
    rubber.addColorStop(0, '#0e6b50');
    rubber.addColorStop(0.28, '#0b4f3c');
    rubber.addColorStop(1, '#073a2c');
    g.fillStyle = rubber;
    roundRect(g, bx, by, bw, bh, 15);
    g.fill();
    // 库边内缘上下受光
    g.strokeStyle = 'rgba(125,255,214,0.30)';
    g.lineWidth = 2.5;
    roundRect(g, bx, by, bw, bh, 15);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 2;
    roundRect(g, bx + 2, by + 3, bw - 4, bh - 6, 14);
    g.stroke();

    // 毛毡（深青绿渐变 + 中央亮部）
    var fg = g.createRadialGradient(ox + W * 0.5, oy + H * 0.42, 20, ox + W * 0.5, oy + H * 0.5, Math.max(W, H) * 0.85);
    fg.addColorStop(0, '#1a8566');
    fg.addColorStop(0.55, '#11654c');
    fg.addColorStop(1, '#0a4436');
    g.fillStyle = fg;
    roundRect(g, ox, oy, W, H, 10);
    g.fill();
    // 毛毡质感：细密横纹
    g.save();
    roundRect(g, ox, oy, W, H, 10);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.025)';
    g.lineWidth = 1;
    for (var t = 0; t < 26; t++) {
      var yy = oy + (t + 0.5) * H / 26;
      g.beginPath(); g.moveTo(ox, yy); g.lineTo(ox + W, yy); g.stroke();
    }
    // 角落柔光
    var vg = g.createRadialGradient(ox + W * 0.5, oy + H * 0.5, 10, ox + W * 0.5, oy + H * 0.5, Math.max(W, H) * 0.6);
    vg.addColorStop(0, 'rgba(255,255,255,0.06)');
    vg.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = vg;
    g.fillRect(ox, oy, W, H);
    g.restore();

    // 头线 + 头/脚点
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(ox + P.TABLE_W * 0.25 * sc, oy + 3);
    g.lineTo(ox + P.TABLE_W * 0.25 * sc, oy + H - 3);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.30)';
    g.beginPath(); g.arc(ox + P.TABLE_W * 0.25 * sc, oy + H / 2, 3.5, 0, 6.2832); g.fill();   // 头点
    g.beginPath(); g.arc(ox + P.TABLE_W * 0.75 * sc, oy + H / 2, 3.5, 0, 6.2832); g.fill();   // 脚点

    // 库边钻石标记（12 颗：两长边各 3 + 两短边各 1）
    g.fillStyle = 'rgba(238,230,214,0.85)';
    var dpos = [0.25, 0.5, 0.75];
    for (var q = 0; q < dpos.length; q++) {
      diamond(g, ox + P.TABLE_W * dpos[q] * sc, oy - 5.5, 5, 5);
      diamond(g, ox + P.TABLE_W * dpos[q] * sc, oy + H + 5.5, 5, 5);
    }
    diamond(g, ox - 5.5, oy + H * 0.5, 5, 5);
    diamond(g, ox + W + 5.5, oy + H * 0.5, 5, 5);

    // 口袋（皮革圆环 + 深邃洞心 + 高光）
    var pockets = P.POCKETS;
    for (var p = 0; p < pockets.length; p++) {
      var px = ox + pockets[p].x * sc, py = oy + pockets[p].y * sc;
      var pr = pockets[p].r * sc;
      // 皮革环
      var rmg = g.createRadialGradient(px - pr * 0.2, py - pr * 0.2, pr * 0.2, px, py, pr * 1.35);
      rmg.addColorStop(0, '#4a3a28');
      rmg.addColorStop(0.7, '#2e2114');
      rmg.addColorStop(1, '#1a1209');
      g.fillStyle = rmg;
      g.beginPath(); g.arc(px, py, pr * 1.35, 0, 6.2832); g.fill();
      // 洞心
      var hole = g.createRadialGradient(px - pr * 0.25, py - pr * 0.25, 1, px, py, pr);
      hole.addColorStop(0, '#000000');
      hole.addColorStop(0.75, '#05080d');
      hole.addColorStop(1, '#0d1626');
      g.fillStyle = hole;
      g.beginPath(); g.arc(px, py, pr * 0.92, 0, 6.2832); g.fill();
      // 高光弧
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(px, py, pr * 1.12, Math.PI * 0.9, Math.PI * 1.55); g.stroke();
    }
  };

  /* 菱形标记 */
  function diamond(g, x, y, w, h) {
    g.beginPath();
    g.moveTo(x, y - h);
    g.lineTo(x + w, y);
    g.lineTo(x, y + h);
    g.lineTo(x - w, y);
    g.closePath();
    g.fill();
  }

  PoolRender.prototype._drawBalls = function (g, world, ui) {
    var P = this.P;
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (b.dead || b.ghost) continue;
      var px = this.ox + b.x * this.scale, py = this.oy + b.y * this.scale;
      var r = b.r * this.scale;
      // 阴影
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.beginPath();
      g.ellipse(px + r * 0.15, py + r * 0.25, r * 0.95, r * 0.8, 0, 0, 6.2832);
      g.fill();
      // 运动拖尾
      var sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 > 0.6) {
        var sp = Math.sqrt(sp2);
        var tl = Math.min(0.55, sp * 0.06);
        var tx = -b.vx / sp * tl * this.scale, ty = -b.vy / sp * tl * this.scale;
        var tg = g.createLinearGradient(px, py, px + tx, py + ty);
        tg.addColorStop(0, 'rgba(34,211,238,0.28)');
        tg.addColorStop(1, 'rgba(34,211,238,0)');
        g.strokeStyle = tg;
        g.lineWidth = r * 0.7;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + tx, py + ty);
        g.stroke();
      }
      this._drawBall(g, b.type, px, py, r);
    }
    // 白球高亮（抬起光）
    var cue = null;
    for (i = 0; i < world.balls.length; i++) if (world.balls[i].type === 0) { cue = world.balls[i]; break; }
    if (cue && !cue.dead && !cue.ghost) {
      var cpx = this.ox + cue.x * this.scale, cpy = this.oy + cue.y * this.scale;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(cpx, cpy, cue.r * this.scale + 2, 0, 6.2832); g.stroke();
    }
  };

  PoolRender.prototype._drawBall = function (g, type, px, py, r) {
    var base = BALL_COLORS[type] || '#ffffff';
    var isCue = type === 0;
    if (isCue) {
      var cg = g.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.65, '#eef2f6');
      cg.addColorStop(1, '#c7d0d8');
      g.fillStyle = cg;
      g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
      return;
    }
    var stripe = type >= 9 && type <= 15;
    // 底色
    var bg = g.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
    bg.addColorStop(0, lighten(base, 0.55));
    bg.addColorStop(0.55, base);
    bg.addColorStop(1, darken(base, 0.5));
    g.fillStyle = bg;
    g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
    if (stripe) {
      // 花色：白色球体中央一条色带（沿上下方向）
      g.save();
      g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.clip();
      var band = g.createLinearGradient(px, py - r, px, py + r);
      band.addColorStop(0, base);
      band.addColorStop(0.5, lighten(base, 0.35));
      band.addColorStop(1, base);
      g.fillStyle = band;
      g.fillRect(px - r * 0.26, py - r, r * 0.52, r * 2);
      // 边缘高光
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.arc(px - r * 0.35, py - r * 0.4, r * 0.28, 0, 6.2832); g.fill();
      g.restore();
    }
    // 号码圈
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(px, py, r * 0.34, 0, 6.2832); g.fill();
    g.fillStyle = type === 8 ? '#000000' : darken(BALL_COLORS[type], 0.35);
    g.font = 'bold ' + Math.max(8, Math.round(r * 0.55)) + 'px "SF Pro Rounded", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(type), px, py + 0.5);
    if (!stripe) {
      // 全色：边缘高光
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath(); g.ellipse(px - r * 0.35, py - r * 0.42, r * 0.3, r * 0.16, -0.6, 0, 6.2832); g.fill();
    }
  };

  PoolRender.prototype._drawAim = function (g, world, ui) {
    var P = this.P;
    var cue = null;
    for (var i = 0; i < world.balls.length; i++) if (world.balls[i].type === 0 && !world.balls[i].dead) { cue = world.balls[i]; break; }
    if (!cue) return;
    var px = this.ox + cue.x * this.scale, py = this.oy + cue.y * this.scale;
    var dx = ui.aim.x, dy = ui.aim.y;
    // 目标球高亮（命中点）
    if (ui.targetHit && ui.targetHit.x !== undefined) {
      var tpx = this.ox + ui.targetHit.x * this.scale, tpy = this.oy + ui.targetHit.y * this.scale;
      g.strokeStyle = 'rgba(167,139,250,0.9)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(tpx, tpy, P.R * this.scale + 3, 0, 6.2832); g.stroke();
      g.fillStyle = 'rgba(167,139,250,0.35)';
      g.beginPath(); g.arc(tpx, tpy, 4, 0, 6.2832); g.fill();
    }
    // 瞄准虚线（沿鼠标方向，带箭头）
    var nx = dx / Math.hypot(dx, dy) || 1, ny = dy / Math.hypot(dx, dy) || 0;
    var lineLen = 110;
    var sx = px + nx * (P.R * this.scale + 4), sy = py + ny * (P.R * this.scale + 4);
    var ex = px + nx * (P.R * this.scale + 4 + lineLen), ey = py + ny * (P.R * this.scale + 4 + lineLen);
    g.setLineDash([7, 8]);
    g.strokeStyle = 'rgba(34,211,238,0.6)';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(ex - 10, ey - 10);
    g.stroke();
    g.setLineDash([]);
    // 箭头
    var ang = Math.atan2(ny, nx);
    g.fillStyle = 'rgba(34,211,238,0.9)';
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(ex - 13 * Math.cos(ang - 0.42), ey - 13 * Math.sin(ang - 0.42));
    g.lineTo(ex - 13 * Math.cos(ang + 0.42), ey - 13 * Math.sin(ang + 0.42));
    g.closePath();
    g.fill();
  };

  PoolRender.prototype._drawCue = function (g, ui) {
    var world = ui.world || ui._world;
    if (!world) return;
    var cue = null;
    for (var i = 0; i < world.balls.length; i++) if (world.balls[i].type === 0 && !world.balls[i].dead) { cue = world.balls[i]; break; }
    if (!cue) return;
    var px = this.ox + cue.x * this.scale, py = this.oy + cue.y * this.scale;
    var dx = ui.aim.x, dy = ui.aim.y;
    var h = Math.hypot(dx, dy) || 1;
    var fx = dx / h, fy = dy / h;                 // 瞄准方向 = 鼠标方向（杆朝鼠标指）
    var pull = 0.3 + (ui.power || 0) * 0.7;       // 后拉量：越大杆越"收"
    var stickLen = 1.9 * this.scale;
    var back = pull * 52;                          // 蓄力时杆尖后移（收杆）
    var x0 = px + fx * (cue.r * this.scale * 1.05 - back);
    var y0 = py + fy * (cue.r * this.scale * 1.05 - back);
    var x1 = x0 + fx * stickLen, y1 = y0 + fy * stickLen;
    var ang = Math.atan2(y1 - y0, x1 - x0);
    var shaftLen = stickLen * (1 - pull * 0.18);
    g.save();
    g.translate(x0, y0);
    g.rotate(ang);
    // 前节（靠近球的一端，浅木色）
    var sp = g.createLinearGradient(0, -4.2, 0, 4.2);
    sp.addColorStop(0, '#f3e5c8');
    sp.addColorStop(0.5, '#fbf2dc');
    sp.addColorStop(1, '#d9c9a5');
    g.fillStyle = sp;
    roundedRectAt(g, 0, -4.2, shaftLen, 8.4, 4.2);
    g.fill();
    // 皮头
    g.fillStyle = '#8ec4ee';
    roundedRectAt(g, -2, -4.0, 8, 8.0, 3.5);
    g.fill();
    // 后把（远端深木色带渐变）
    var bp = g.createLinearGradient(0, -5.4, 0, 5.4);
    bp.addColorStop(0, '#3d2413');
    bp.addColorStop(0.5, '#5c3a1e');
    bp.addColorStop(1, '#2f1809');
    g.fillStyle = bp;
    roundedRectAt(g, shaftLen, -4.6, Math.max(40, stickLen - shaftLen), 9.2, 4.5);
    g.fill();
    // 底部装饰环 + 尾珠
    g.fillStyle = '#e9e2d2';
    roundedRectAt(g, stickLen - 6, -4.0, 6, 8.0, 2);
    g.fill();
    g.fillStyle = '#0f0a06';
    g.beginPath(); g.arc(stickLen + 3, 0, 5.5, 0, 6.2832); g.fill();
    g.restore();
  };

  PoolRender.prototype._drawPlacement = function (g, pos, ok) {
    var P = this.P;
    var px = this.ox + pos.x * this.scale, py = this.oy + pos.y * this.scale;
    var r = P.R * this.scale;
    g.strokeStyle = ok ? 'rgba(52,211,153,0.95)' : 'rgba(248,113,113,0.95)';
    g.lineWidth = 2;
    g.setLineDash([4, 5]);
    g.beginPath(); g.arc(px, py, r + 6, 0, 6.2832); g.stroke();
    g.setLineDash([]);
    g.fillStyle = ok ? 'rgba(52,211,153,0.18)' : 'rgba(248,113,113,0.15)';
    g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.4;
    g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.stroke();
  };

  PoolRender.prototype._drawCallPocket = function (g, idx, t) {
    var P = this.P, pockets = P.POCKETS;
    var p = pockets[idx];
    if (!p) return;
    var px = this.ox + p.x * this.scale, py = this.oy + p.y * this.scale;
    var pr = p.r * this.scale * 1.25;
    var pulse = 0.5 + 0.5 * Math.sin(t / 180);
    g.strokeStyle = 'rgba(251,191,36,' + (0.5 + pulse * 0.5) + ')';
    g.lineWidth = 3;
    g.beginPath(); g.arc(px, py, pr + 4 + pulse * 5, 0, 6.2832); g.stroke();
  };

  /* 工具 */
  function roundedRectAt(g, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function roundRect(g, x, y, w, h, r) { roundedRectAt(g, x, y, w, h, r); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lighten(hex, amt) {
    var c = hexToRgb(hex); if (!c) return hex;
    var f = function (v) { return Math.round(v + (255 - v) * amt); };
    return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
  }
  function darken(hex, amt) {
    var c = hexToRgb(hex); if (!c) return hex;
    var f = function (v) { return Math.round(v * (1 - amt)); };
    return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
  }
  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }

  global.PoolRender = PoolRender;
  global.PoolRender.BALL_COLORS = BALL_COLORS;
})(typeof window !== 'undefined' ? window : globalThis);