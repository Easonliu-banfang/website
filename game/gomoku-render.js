/* 五子棋渲染层（Canvas）：棋盘网格 + 棋子 + 最后一手高亮 + 悬停预览。 */
(function (global) {
  'use strict';

  var SIZE = 15;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = SIZE;
    this.margin = 26;     // 边距
    this.hover = null;    // {r,c} 悬停格
    this.interactive = false;
    this._resize();
  }

  Renderer.prototype._resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(280, Math.min(rect.width, 560));
    // 用 CSS 宽度，但保证正方形
    this.canvas.width = w * dpr;
    this.canvas.height = w * dpr;
    this.canvas.style.height = w + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.gap = (w - this.margin * 2) / (SIZE - 1);
  };

  Renderer.prototype.resize = function () { this._resize(); };

  Renderer.prototype._xy = function (r, c) {
    return [this.margin + c * this.gap, this.margin + r * this.gap];
  };

  Renderer.prototype.hitCell = function (x, y) {
    var c = Math.round((x - this.margin) / this.gap);
    var r = Math.round((y - this.margin) / this.gap);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    var p = this._xy(r, c);
    var dx = x - p[0], dy = y - p[1];
    if (dx * dx + dy * dy > (this.gap * 0.5) * (this.gap * 0.5)) return null;
    return { r: r, c: c };
  };

  Renderer.prototype.draw = function (state, opts) {
    opts = opts || {};
    var ctx = this.ctx, w = this.cssW, g = this.gap;
    this.interactive = !!opts.interactive;
    this.hover = opts.hover || null;
    ctx.clearRect(0, 0, w, w);

    // 背景
    var grad = ctx.createLinearGradient(0, 0, w, w);
    grad.addColorStop(0, '#f3d9a6');
    grad.addColorStop(1, '#e7c27d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, w);

    // 网格
    ctx.strokeStyle = 'rgba(70,45,20,0.55)';
    ctx.lineWidth = 1;
    for (var i = 0; i < SIZE; i++) {
      var p1 = this._xy(i, 0), p2 = this._xy(i, SIZE - 1);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      var p3 = this._xy(0, i), p4 = this._xy(SIZE - 1, i);
      ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.stroke();
    }
    // 星位
    var stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
    ctx.fillStyle = 'rgba(70,45,20,0.7)';
    for (var s = 0; s < stars.length; s++) {
      var sp = this._xy(stars[s][0], stars[s][1]);
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 3, 0, Math.PI * 2); ctx.fill();
    }

    // 棋子
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = state.board[r][c];
        if (v === 0) continue;
        this._stone(r, c, v);
      }
    }

    // 悬停预览
    if (this.hover && this.interactive && state.board[this.hover.r][this.hover.c] === 0) {
      var hp = this._xy(this.hover.r, this.hover.c);
      ctx.globalAlpha = 0.45;
      this._stone(this.hover.r, this.hover.c, opts.previewColor || state.turn);
      ctx.globalAlpha = 1;
    }

    // 最后一手标记
    if (state.last) {
      var lp = this._xy(state.last[0], state.last[1]);
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(lp[0], lp[1], g * 0.18, 0, Math.PI * 2); ctx.stroke();
    }
  };

  Renderer.prototype._stone = function (r, c, v) {
    var ctx = this.ctx, p = this._xy(r, c), rad = this.gap * 0.42;
    var grad = ctx.createRadialGradient(p[0] - rad * 0.3, p[1] - rad * 0.3, rad * 0.1, p[0], p[1], rad);
    if (v === 1) { grad.addColorStop(0, '#5a5a5a'); grad.addColorStop(1, '#0d0d0d'); }
    else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#c9c9c9'); }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  };

  global.GRender = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
