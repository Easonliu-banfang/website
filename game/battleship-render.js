/* 海战棋 Canvas 渲染层 —— 单块棋盘（己方海洋 ocean / 追踪板 tracking），深色极客风。
 * 与 Quoridor 的 QRender 解耦：海战棋用两块独立棋盘，这里一个 Renderer 画一块。
 */
(function (global) {
  'use strict';

  var N = 10;

  // 5 艘船配色
  var SHIP_COLORS = ['#4ee8f7', '#a78bfa', '#fbbf24', '#34d399', '#f472b6'];

  var C = {
    board: '#0e141d',
    boardEdge: '#1d2836',
    cell: '#16202e',
    cellAlt: '#1a2535',
    cellEdge: '#27313f',
    hit: '#f87171',
    hitGlow: 'rgba(248,113,113,0.5)',
    missDot: '#3f5d82',
    sunk: 'rgba(248,113,113,0.28)',
    hoverOk: 'rgba(34,211,238,0.30)',
    hoverBad: 'rgba(248,113,113,0.30)',
    label: '#5a6675',
    ghostOk: 'rgba(34,211,238,0.5)',
    ghostBad: 'rgba(248,113,113,0.5)'
  };

  function Renderer(canvas, mode) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode || 'ocean';   // 'ocean' | 'tracking'
    this.dpr = global.devicePixelRatio || 1;
    this.pad = 22;                 // 留给坐标标签
    this.hover = null;             // {r,c}
    this.preview = null;           // 放船预览：{cells:[[r,c]...], valid:bool}
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var w = this.canvas.clientWidth || 360;
    var h = this.canvas.clientHeight || w;
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var inner = Math.min(w, h) - this.pad * 2;
    this.pitch = inner / N;
    this.ox = (w - inner) / 2;
    this.oy = (h - inner) / 2;
  };

  Renderer.prototype.cellRect = function (r, c) {
    return { x: this.ox + c * this.pitch, y: this.oy + r * this.pitch, s: this.pitch };
  };

  Renderer.prototype.hitCell = function (mx, my) {
    var c = Math.floor((mx - this.ox) / this.pitch);
    var r = Math.floor((my - this.oy) / this.pitch);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    return { r: r, c: c };
  };

  Renderer.prototype.roundRect = function (x, y, w, h, rad) {
    var g = this.ctx;
    rad = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  };

  Renderer.prototype.draw = function (state, myPlayer, ui) {
    ui = ui || {};
    var g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);

    // 底板
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 22; g.shadowOffsetY = 8;
    this.roundRect(this.ox - 8, this.oy - 8, N * this.pitch + 16, N * this.pitch + 16, 12);
    g.fillStyle = C.board; g.fill();
    g.restore();
    g.strokeStyle = C.boardEdge; g.lineWidth = 1;
    this.roundRect(this.ox - 8, this.oy - 8, N * this.pitch + 16, N * this.pitch + 16, 12);
    g.stroke();

    // 坐标标签（列 A-J，行 1-10）
    g.fillStyle = C.label;
    g.font = Math.max(9, this.pitch * 0.26) + 'px var(--mono, monospace)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (var c = 0; c < N; c++) {
      g.fillText(String.fromCharCode(65 + c), this.ox + c * this.pitch + this.pitch / 2, this.oy - this.pad / 2);
    }
    for (var r = 0; r < N; r++) {
      g.fillText(String(r + 1), this.ox - this.pad / 2, this.oy + r * this.pitch + this.pitch / 2);
    }

    for (r = 0; r < N; r++) {
      for (c = 0; c < N; c++) {
        this.drawCell(r, c, state, myPlayer, ui);
      }
    }

    // 放船预览
    if (this.preview && this.preview.cells) {
      for (var i = 0; i < this.preview.cells.length; i++) {
        var rc = this.preview.cells[i];
        var rect = this.cellRect(rc[0], rc[1]);
        g.fillStyle = this.preview.valid ? C.ghostOk : C.ghostBad;
        this.roundRect(rect.x + 2, rect.y + 2, rect.s - 4, rect.s - 4, 5);
        g.fill();
      }
    }
  };

  Renderer.prototype.drawCell = function (r, c, state, myPlayer, ui) {
    var g = this.ctx;
    var rect = this.cellRect(r, c);
    var cx = rect.x + rect.s / 2, cy = rect.y + rect.s / 2;

    // 底色
    g.fillStyle = ((r + c) % 2 === 0) ? C.cell : C.cellAlt;
    this.roundRect(rect.x + 1, rect.y + 1, rect.s - 2, rect.s - 2, 4);
    g.fill();
    g.strokeStyle = C.cellEdge; g.lineWidth = 0.5; g.stroke();

    if (this.mode === 'ocean') {
      var cell = state.ocean[myPlayer][r][c];
      if (cell.ship !== -1) {
        var col = SHIP_COLORS[cell.ship];
        g.fillStyle = cell.hit ? 'rgba(248,113,113,0.55)' : col;
        this.roundRect(rect.x + 2, rect.y + 2, rect.s - 4, rect.s - 4, 5);
        g.fill();
        if (cell.hit) this.drawX(cx, cy, rect.s * 0.3);
      }
      if (cell.hit) this.drawX(cx, cy, rect.s * 0.3);
    } else {
      // tracking：自己朝对手开火的结果
      var f = state.fire[myPlayer][r][c];
      if (f === 1) {              // 未命中
        g.fillStyle = C.missDot;
        g.beginPath(); g.arc(cx, cy, rect.s * 0.1, 0, Math.PI * 2); g.fill();
      } else if (f === 2) {       // 命中
        this.drawBoom(cx, cy, rect.s * 0.32);
      } else if (f === 3) {       // 击沉（揭示船形）
        g.save();
        g.fillStyle = C.sunk;
        this.roundRect(rect.x + 2, rect.y + 2, rect.s - 4, rect.s - 4, 5);
        g.fill();
        g.restore();
        this.drawBoom(cx, cy, rect.s * 0.28);
      }
    }

    // 悬停高亮（仅 tracking 且可开火时）
    if (this.mode === 'tracking' && this.hover && this.hover.r === r && this.hover.c === c && ui.canFire) {
      g.fillStyle = C.hoverOk;
      this.roundRect(rect.x + 2, rect.y + 2, rect.s - 4, rect.s - 4, 5);
      g.fill();
    }
  };

  Renderer.prototype.drawX = function (cx, cy, rad) {
    var g = this.ctx;
    g.save();
    g.strokeStyle = '#fee2e2'; g.lineWidth = Math.max(2, rad * 0.28);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - rad, cy - rad); g.lineTo(cx + rad, cy + rad);
    g.moveTo(cx + rad, cy - rad); g.lineTo(cx - rad, cy + rad);
    g.stroke();
    g.restore();
  };

  Renderer.prototype.drawBoom = function (cx, cy, rad) {
    var g = this.ctx;
    g.save();
    g.shadowColor = C.hitGlow; g.shadowBlur = 12;
    g.fillStyle = C.hit;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
    g.restore();
  };

  global.BRender = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
