/* Canvas 渲染层 —— 棋盘、墙、棋子、提示、动画 */
(function (global) {
  'use strict';

  var N = 9, S = 8;

  var C = {
    board: '#0e141d',
    boardEdge: '#1d2836',
    cell: '#1c2635',
    cellAlt: '#212d3e',
    cellEdge: '#2c3847',
    p1a: '#4ee8f7', p1b: '#0d8faf',
    p2a: '#c9b8fd', p2b: '#7446d4',
    goal1: 'rgba(34,211,238,0.09)',
    goal2: 'rgba(167,139,250,0.09)',
    wallTop: '#55677f',
    wallBot: '#2a3443',
    wallLine: '#6d829c',
    ok: 'rgba(34,211,238,0.42)',
    bad: 'rgba(226,75,74,0.42)',
    hint: '#22d3ee'
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = global.devicePixelRatio || 1;
    this.pad = 16;
    this.anim = null;
    this.hover = null;
    this.hints = [];
    this.pulse = 0;
    this.flip = false;   // true 时棋盘上下翻转：让后手(紫方)也能看到自己在底部
    this.resize();
  }

  /* 逻辑坐标(r,c) ⇄ 显示坐标 的换算（flip 时绕中心 180°） */
  Renderer.prototype._dr = function (r) { return this.flip ? (N - 1 - r) : r; };
  Renderer.prototype._dc = function (c) { return this.flip ? (N - 1 - c) : c; };
  Renderer.prototype._lr = function (dr) { return this.flip ? (N - 1 - dr) : dr; };
  Renderer.prototype._lc = function (dc) { return this.flip ? (N - 1 - dc) : dc; };

  Renderer.prototype.resize = function () {
    var w = this.canvas.clientWidth || 480;
    var h = this.canvas.clientHeight || w;
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    var inner = Math.min(w, h) - this.pad * 2;
    this.pitch = inner / N;
    this.gap = Math.max(7, this.pitch * 0.26);
    this.cell = this.pitch - this.gap;
    var boardW = N * this.pitch - this.gap;
    this.ox = (w - boardW) / 2;
    this.oy = (h - boardW) / 2;
  };

  /* ---------- 坐标换算 ---------- */

  Renderer.prototype.cellRect = function (r, c) {
    var dr = this._dr(r), dc = this._dc(c);
    return { x: this.ox + dc * this.pitch, y: this.oy + dr * this.pitch, s: this.cell };
  };

  Renderer.prototype.hitCell = function (mx, my) {
    var c = Math.floor((mx - this.ox) / this.pitch);
    var r = Math.floor((my - this.oy) / this.pitch);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    var lx = mx - this.ox - c * this.pitch;
    var ly = my - this.oy - r * this.pitch;
    if (lx > this.cell || ly > this.cell) return null;   // 落在缝隙上
    return { r: this._lr(r), c: this._lc(c) };
  };

  /* 墙槽互相重叠一格，取中心最近的那个 */
  Renderer.prototype.hitWall = function (mx, my) {
    var best = null, bestD = Infinity, i, j, d, cx, cy;
    for (i = 0; i < S; i++) {
      for (j = 0; j < S; j++) {
        var hx = this.ox + j * this.pitch;
        var hy = this.oy + i * this.pitch + this.cell;
        var hw = 2 * this.cell + this.gap;
        if (mx >= hx && mx <= hx + hw && my >= hy && my <= hy + this.gap) {
          cx = hx + hw / 2; cy = hy + this.gap / 2;
          d = (mx - cx) * (mx - cx) + (my - cy) * (my - cy);
          if (d < bestD) { bestD = d; best = { r: i, c: j, dir: 'H' }; }
      }
      var vx = this.ox + j * this.pitch + this.cell;
      var vy = this.oy + i * this.pitch;
      var vh = 2 * this.cell + this.gap;
      if (mx >= vx && mx <= vx + this.gap && my >= vy && my <= vy + vh) {
        cx = vx + this.gap / 2; cy = vy + vh / 2;
        d = (mx - cx) * (mx - cx) + (my - cy) * (my - cy);
        if (d < bestD) { bestD = d; best = { r: i, c: j, dir: 'V' }; }
      }
    }
  }
  if (!best) return null;
  return { r: this._lr(best.r), c: this._lc(best.c), dir: best.dir };
};

  /* ---------- 绘制 ---------- */

  Renderer.prototype.draw = function (state, ui) {
    var g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    this.pulse = (Date.now() % 1400) / 1400;

    this.drawBoard();
    this.drawGoals();
    this.drawCells(state);
    this.drawWalls(state, 'wallsH', 'H');
    this.drawWalls(state, 'wallsV', 'V');
    this.drawPreview();
    this.drawHints();
    this.drawPieces(state);
  };

  Renderer.prototype.drawBoard = function () {
    var g = this.ctx, s = N * this.pitch - this.gap, r = 14;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 28;
    g.shadowOffsetY = 10;
    this.roundRect(this.ox - 10, this.oy - 10, s + 20, s + 20, r);
    g.fillStyle = C.board;
    g.fill();
    g.restore();

    g.strokeStyle = C.boardEdge;
    g.lineWidth = 1;
    this.roundRect(this.ox - 10, this.oy - 10, s + 20, s + 20, r);
    g.stroke();
  };

  Renderer.prototype.drawGoals = function () {
    var g = this.ctx, s = N * this.pitch - this.gap;
    var top = { x: this.ox, y: this.oy, w: s, h: this.cell };
    var bot = { x: this.ox, y: this.oy + (N - 1) * this.pitch, w: s, h: this.cell };
    // 上/下起点染色：flip 时交换，使每位玩家看到的自己起点都在底部
    var topColor = this.flip ? C.goal1 : C.goal2;
    var botColor = this.flip ? C.goal2 : C.goal1;
    g.fillStyle = topColor;   // P1(紫) 起点 / flip 时为 P0(青) 起点
    g.fillRect(top.x, top.y, top.w, top.h);
    g.fillStyle = botColor;   // P0(青) 起点 / flip 时为 P1(紫) 起点
    g.fillRect(bot.x, bot.y, bot.w, bot.h);
  };

  Renderer.prototype.drawCells = function (state) {
    var g = this.ctx, r, c, rect;
    for (r = 0; r < N; r++) {
      for (c = 0; c < N; c++) {
        rect = this.cellRect(r, c);
        g.fillStyle = ((r + c) % 2 === 0) ? C.cell : C.cellAlt;
        this.roundRect(rect.x, rect.y, rect.s, rect.s, 5);
        g.fill();
        g.strokeStyle = C.cellEdge;
        g.lineWidth = 0.6;
        g.stroke();
      }
    }
  };

  Renderer.prototype.drawWalls = function (state, field, dir) {
    var g = this.ctx, k, parts;
    for (k in state[field]) {
      if (!state[field].hasOwnProperty(k)) continue;
      parts = k.split(',');
      this.drawWall(+parts[0], +parts[1], dir, false, null);
    }
  };

  Renderer.prototype.drawWall = function (r, c, dir, ghost, valid) {
    var g = this.ctx, x, y, w, h;
    if (dir === 'H') {
      x = this.ox + c * this.pitch;
      y = this.oy + r * this.pitch + this.cell;
      w = 2 * this.cell + this.gap;
      h = this.gap;
    } else {
      x = this.ox + c * this.pitch + this.cell;
      y = this.oy + r * this.pitch;
      w = this.gap;
      h = 2 * this.cell + this.gap;
    }
    var rad = Math.min(3, this.gap / 3);

    g.save();
    if (ghost) {
      g.globalAlpha = 0.85;
      g.fillStyle = valid ? C.ok : C.bad;
      this.roundRect(x, y, w, h, rad);
      g.fill();
      g.strokeStyle = valid ? 'rgba(34,211,238,0.95)' : 'rgba(226,75,74,0.95)';
      g.lineWidth = 1.4;
      g.setLineDash([5, 4]);
      g.stroke();
      g.setLineDash([]);
      g.restore();
      return;
    }

    // 投影
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 7;
    g.shadowOffsetY = 2.5;
    this.roundRect(x, y, w, h, rad);
    g.fillStyle = C.wallBot;
    g.fill();
    g.restore();

    // 主体渐变 + 顶面高光
    g.save();
    var grad = (dir === 'H')
      ? g.createLinearGradient(0, y, 0, y + h)
      : g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, C.wallTop);
    grad.addColorStop(0.5, C.wallTop);
    grad.addColorStop(1, C.wallBot);
    g.fillStyle = grad;
    this.roundRect(x, y, w, h, rad);
    g.fill();
    g.strokeStyle = C.wallLine;
    g.lineWidth = 0.7;
    g.stroke();
    g.restore();
  };

  Renderer.prototype.drawPreview = function () {
    var hv = this.hover;
    if (!hv || hv.type !== 'wall') return;
    this.drawWall(hv.r, hv.c, hv.dir, true, hv.valid);
  };

  Renderer.prototype.drawHints = function () {
    var g = this.ctx, i, rect, cx, cy;
    var a = 0.55 + 0.4 * Math.sin(this.pulse * Math.PI * 2);
    for (i = 0; i < this.hints.length; i++) {
      rect = this.cellRect(this.hints[i].r, this.hints[i].c);
      cx = rect.x + rect.s / 2;
      cy = rect.y + rect.s / 2;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = C.hint;
      g.shadowColor = C.hint;
      g.shadowBlur = 12;
      g.beginPath();
      g.arc(cx, cy, Math.max(4, rect.s * 0.14), 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  };

  Renderer.prototype.drawPieces = function (state) {
    var p, pos, rect, cx, cy, rad;
    for (p = 0; p < 2; p++) {
      pos = this.animPos(p, state);
      rect = this.cellRect(pos.r, pos.c);
      cx = rect.x + rect.s / 2;
      cy = rect.y + rect.s / 2;
      rad = rect.s * 0.36;
      this.drawPiece(cx, cy, rad, p, state.turn === p && state.winner < 0);
    }
  };

  Renderer.prototype.drawPiece = function (cx, cy, rad, p, active) {
    var g = this.ctx;
    var a = p === 0 ? C.p1a : C.p2a;
    var b = p === 0 ? C.p1b : C.p2b;

    g.save();
    if (active) {
      g.shadowColor = a;
      g.shadowBlur = 18 + 6 * Math.sin(this.pulse * Math.PI * 2);
    } else {
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = 8;
      g.shadowOffsetY = 3;
    }
    var grad = g.createRadialGradient(cx - rad * 0.35, cy - rad * 0.4, rad * 0.15, cx, cy, rad);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx - rad * 0.28, cy - rad * 0.32, rad * 0.22, 0, Math.PI * 2);
    g.fill();
    g.restore();

    if (active) {
      g.save();
      g.strokeStyle = a;
      g.globalAlpha = 0.55;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, rad + 4.5, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  };

  /* ---------- 移动动画 ---------- */

  Renderer.prototype.startAnim = function (p, from, to) {
    this.anim = { p: p, from: from, to: to, t0: performance.now(), dur: 230 };
  };

  Renderer.prototype.animPos = function (p, state) {
    var cur = state.players[p];
    if (!this.anim || this.anim.p !== p) return { r: cur.r, c: cur.c };
    var t = (performance.now() - this.anim.t0) / this.anim.dur;
    if (t >= 1) { this.anim = null; return { r: cur.r, c: cur.c }; }
    var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
    var f = this.anim.from;
    return {
      r: f.r + (this.anim.to.r - f.r) * e,
      c: f.c + (this.anim.to.c - f.c) * e
    };
  };

  Renderer.prototype.roundRect = function (x, y, w, h, r) {
    var g = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  global.QRender = Renderer;
})(window);
