/* 围棋渲染层（Canvas）：自适应 9/13/19 路，网格 + 星位 + 棋子 + 最后一手 + 劫点 + 悬停预览。 */
(function (global) {
  'use strict';

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.margin = 22;
    this.hover = null;
    this.interactive = false;
    this.size = 19;
    this._resize();
  }

  function starPoints(n) {
    if (n === 9) return [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];
    if (n === 13) return [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
    // 19
    return [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
  }

  Renderer.prototype._resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(280, Math.min(rect.width, 560));
    this.canvas.width = w * dpr;
    this.canvas.height = w * dpr;
    this.canvas.style.height = w + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
  };

  Renderer.prototype.resize = function () { this._resize(); };

  Renderer.prototype._xy = function (r, c) {
    return [this.margin + c * this.gap, this.margin + r * this.gap];
  };

  Renderer.prototype.hitCell = function (x, y) {
    var c = Math.round((x - this.margin) / this.gap);
    var r = Math.round((y - this.margin) / this.gap);
    if (r < 0 || r >= this.size || c < 0 || c >= this.size) return null;
    var p = this._xy(r, c);
    var dx = x - p[0], dy = y - p[1];
    if (dx * dx + dy * dy > (this.gap * 0.45) * (this.gap * 0.45)) return null;
    return { r: r, c: c };
  };

  Renderer.prototype.draw = function (state, opts) {
    opts = opts || {};
    var ctx = this.ctx, w = this.cssW;
    this.size = state.size;
    this.gap = (w - this.margin * 2) / (this.size - 1);
    this.interactive = !!opts.interactive;
    this.hover = opts.hover || null;
    ctx.clearRect(0, 0, w, w);

    // 背景
    var grad = ctx.createLinearGradient(0, 0, w, w);
    grad.addColorStop(0, '#e8c98c');
    grad.addColorStop(1, '#dcb86a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, w);

    // 网格
    ctx.strokeStyle = 'rgba(60,40,15,0.6)';
    ctx.lineWidth = 1;
    for (var i = 0; i < this.size; i++) {
      var p1 = this._xy(i, 0), p2 = this._xy(i, this.size - 1);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      var p3 = this._xy(0, i), p4 = this._xy(this.size - 1, i);
      ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.stroke();
    }
    // 星位
    var stars = starPoints(this.size);
    ctx.fillStyle = 'rgba(60,40,15,0.8)';
    for (var s = 0; s < stars.length; s++) {
      var sp = this._xy(stars[s][0], stars[s][1]);
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 3, 0, Math.PI * 2); ctx.fill();
    }

    // 棋子
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        var v = state.board[r][c];
        if (v === 0) continue;
        this._stone(r, c, v);
      }
    }

    // 数子阶段：标记死子（红叉）
    if (opts.scoring && opts.deadSet) {
      ctx.strokeStyle = '#ff3b5c'; ctx.lineWidth = 2.5;
      for (var di = 0; di < opts.deadSet.length; di++) {
        var dp = this._xy(opts.deadSet[di][0], opts.deadSet[di][1]);
        var rad = this.gap * 0.46;
        ctx.beginPath();
        ctx.moveTo(dp[0] - rad, dp[1] - rad); ctx.lineTo(dp[0] + rad, dp[1] + rad);
        ctx.moveTo(dp[0] + rad, dp[1] - rad); ctx.lineTo(dp[0] - rad, dp[1] + rad);
        ctx.stroke();
      }
    }

    // 悬停预览（仅空格且可交互）
    if (this.hover && this.interactive && state.board[this.hover.r][this.hover.c] === 0) {
      var hp = this._xy(this.hover.r, this.hover.c);
      ctx.globalAlpha = 0.4;
      this._stone(this.hover.r, this.hover.c, opts.previewColor || state.turn);
      ctx.globalAlpha = 1;
    }

    // 劫点提示
    if (state.ko) {
      var kp = this._xy(state.ko[0], state.ko[1]);
      ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(kp[0], kp[1], this.gap * 0.3, 0, Math.PI * 2); ctx.stroke();
    }

    // 最后一手标记
    var last = state.history[state.history.length - 1];
    if (last && last.r !== undefined) {
      var lp = this._xy(last.r, last.c);
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(lp[0], lp[1], this.gap * 0.16, 0, Math.PI * 2); ctx.stroke();
    }
  };

  Renderer.prototype._stone = function (r, c, v) {
    var ctx = this.ctx, p = this._xy(r, c), rad = this.gap * 0.46;
    var grad = ctx.createRadialGradient(p[0] - rad * 0.3, p[1] - rad * 0.3, rad * 0.1, p[0], p[1], rad);
    if (v === 1) { grad.addColorStop(0, '#5a5a5a'); grad.addColorStop(1, '#0d0d0d'); }
    else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#c9c9c9'); }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  };

  global.GoRender = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
