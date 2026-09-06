/* 四子棋渲染层（Canvas 竖版自绘）：白色棋盘架 + 红/蓝棋子 + 重力掉落动画
 *
 * 布局：
 *   - 白色圆角框架（架子）+ 内部 7x6 圆孔（暗色底）
 *   - 棋子落子时从顶部落下（正上方起始），真实重力加速度，落地轻微回弹一次
 *   - 落定后带一个小的「落地扩散」光晕
 * 坐标：
 *   cell(x,y), r=0 顶部 ~ r=5 底部；col=0 左 ~ 6 右
 */
(function (global) {
  'use strict';

  var ROWS = 6, COLS = 7;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rows = ROWS;
    this.cols = COLS;
    this.hover = null;          // {col} 悬停列（我方可落时高亮）
    this.interactive = false;
    this.fallers = [];          // 下落动画队列 {col,p,t0,x0,y0,targetY}
    this._gravity = 2400;       // px/s^2
    this._lastTs = 0;
    this._raf = null;
    this._resize();
  }

  // ---------- 尺寸 ----------
  Renderer.prototype._resize = function () {
    var dpr = global.devicePixelRatio || 1;
    var parent = this.canvas.parentElement;
    var w = Math.max(300, Math.min(parent ? parent.clientWidth : 560, 560));
    this.canvas.width = w * dpr;
    this.canvas.height = Math.round(w * 1.18) * dpr;   // 竖版：高=宽*1.18（7:6 网格 + 上下留白）
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = (w * 1.18) + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.cssH = w * 1.18;

    // 计算版面：外框留白 + 网格区
    this.pad = Math.max(14, w * 0.05);              // 内边距
    this.gridW = this.cssW - this.pad * 2;
    this.gridH = this.gridW * (ROWS / COLS);        // 网格区高度（7:6）
    this.cell = this.gridW / COLS;                  // 格宽=格高
    // 顶部多加一「投放通道」高度（棋子从上方落下）
    this.chute = this.cell * 0.9;
    this.gridTop = this.pad + this.chute;
    this.cy = function (r) { return this.gridTop + (r + 0.5) * this.cell; };
    this.cx = function (c) { return this.pad + (c + 0.5) * this.cell; };

    this.marginTop = this.gridTop - this.chute;     // 画布顶部 = 网格顶 - 通道
  };
  Renderer.prototype.resize = function () { this._resize(); };

  // ---------- 供外部：列点选（col 命中）----------
  Renderer.prototype.colFromEvent = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var col = Math.floor((x - this.pad) / this.cell);
    if (col < 0 || col >= COLS) return -1;
    return col;
  };
  Renderer.prototype.setHover = function (col) {
    if (this.hover === col) return;
    this.hover = (col === null || col === undefined) ? null : col;
    this._draw();
  };

  // ---------- 动画：把一枚棋子从顶部落下 ----------
  // col: 列；p: 1红/2蓝；targetR: 落点行
  Renderer.prototype.dropPiece = function (col, p, targetR) {
    var x = this.cx(col);
    var startY = -this.cell * 0.4;                  // 从框架上方开始
    var targetY = this.cy(targetR);
    this.fallers.push({
      col: col, p: p, x: x,
      y: startY, vy: 0,          // 注意：初始位置必须赋给 y（_step 用 y 积分），否则 NaN 永不落地
      targetY: targetY,
      t0:  (global.performance || global.Date).now(),
      landed: false,
      bounced: false
    });
    this._ensureLoop();
  };

  Renderer.prototype._ensureLoop = function () {
    var self = this;
    if (this._raf) return;
    this._lastTs =  (global.performance || global.Date).now();
    this._raf = (global.requestAnimationFrame || function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); })(function loop(ts) {
      var dt = Math.min(0.05, (ts - self._lastTs) / 1000);
      self._lastTs = ts;
      self._step(dt);
      self._draw();
      // 清理已落定的动画（保留约 260ms 让落地光晕可见，再移除）
      var now =  (global.performance || global.Date).now();
      for (var i = self.fallers.length - 1; i >= 0; i--) {
        var f = self.fallers[i];
        if (f.landed && now - (f.impact || now) > 260) self.fallers.splice(i, 1);
      }
      if (self.fallers.length) self._raf = (global.requestAnimationFrame || function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); })(loop);
      else self._raf = null;
    });
  };

  // 物理步进：自由落体 → 落地反弹(衰减) → 二次回落停下
  Renderer.prototype._step = function (dt) {
    for (var i = 0; i < this.fallers.length; i++) {
      var f = this.fallers[i];
      if (!f.landed) {
        f.vy += this._gravity * dt;
        f.y += f.vy * dt;
        if (f.y >= f.targetY) {
          if (!f.bounced) {
            // 第一次触底：反弹（速度衰减 45%），记录光晕
            f.bounced = true;
            f.vy = -f.vy * 0.45;
            f.y = f.targetY;
            f.impact =  (global.performance || global.Date).now();
            f.bounceCount = 1;
          } else {
            // 反弹后再次触底：吸收速度，落定
            f.landed = true;
            f.y = f.targetY;
            f.vy = 0;
          }
        }
      }
    }
  };

  // ---------- 绘制 ----------
  Renderer.prototype._draw = function () {
    var ctx = this.ctx, w = this.cssW, h = this.cssH;
    ctx.clearRect(0, 0, w, h);

    // 白架子（圆角大框）
    var fr = 12;
    roundRect(ctx, 0, this.marginTop, w, h - this.marginTop + 4, fr);
    ctx.fillStyle = '#f2f2f0';
    ctx.fill();
    // 架子阴影（底边）
    roundRect(ctx, 0, this.marginTop + 2, w, h - this.marginTop, fr);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();

    // 面板磨砂纹理：顶部高光带
    var grad = ctx.createLinearGradient(0, this.marginTop, 0, this.marginTop + 16);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    roundRect(ctx, 2, this.marginTop, w - 4, 18, 10);
    ctx.fill();

    // 圆孔（暗色凹陷）
    var r = this.cell * 0.42;
    for (var rr = 0; rr < ROWS; rr++) {
      for (var c = 0; c < COLS; c++) {
        var x = this.cx(c), y = this.cy(rr);
        // 孔底阴影（右下）
        ctx.beginPath();
        ctx.arc(x + 1.5, y + 1.5, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        // 孔
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#101418';
        ctx.fill();
        // 孔内高光（左上半圈，营造凹陷）
        ctx.beginPath();
        ctx.arc(x, y, r * 0.86, Math.PI * 1.15, Math.PI * 1.85);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 悬停预览（我方回合可落列）：顶部显示半透明棋子
    if (this.interactive && this.hover != null && this.hover >= 0 && this.hover < COLS) {
      var hx = this.cx(this.hover);
      ctx.beginPath();
      ctx.arc(hx, this.marginTop + this.chute * 0.5, r * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
    }

    // 已落定棋子（来自 game.board，跳过正在下落的棋子格——动画棋子优先画）
    if (this.board) {
      for (var br = 0; br < ROWS; br++) {
        for (var bc = 0; bc < COLS; bc++) {
          var v = this.board[br][bc];
          if (!v) continue;
          // 若该格有下落动画且尚未到终点，暂不画（动画棋子会补上）
          if (this._fallingHere(bc, br)) continue;
          this._paintPiece(bc, br, v);
        }
      }
    }

    // 下落动画棋子 + 落地光晕
    var now =  (global.performance || global.Date).now();
    for (var i = 0; i < this.fallers.length; i++) {
      var f = this.fallers[i];
      if (!f.landed) {
        this._paintPieceAt(f.x, f.y, f.p, r);
      } else {
        this._paintPieceAt(f.x, f.targetY, f.p, r);
        // 落地扩散光环（约 260ms 渐隐）
        var age = now - (f.impact || now);
        if (age < 260) {
          var prog = age / 260;
          ctx.beginPath();
          ctx.arc(f.x, f.targetY, r * (1 + prog * 0.9), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * (1 - prog)).toFixed(3) + ')';
          ctx.lineWidth = 3 * (1 - prog) + 1;
          ctx.stroke();
        }
      }
    }

    // 架子底部站脚
    ctx.fillStyle = '#d8d8d4';
    roundRect(ctx, w * 0.22, h - 6, w * 0.14, 8, 3);
    ctx.fill();
    roundRect(ctx, w * 0.64, h - 6, w * 0.14, 8, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(ctx, w * 0.22, h - 4, w * 0.14, 5, 3);
    ctx.fill();
    roundRect(ctx, w * 0.64, h - 4, w * 0.14, 5, 3);
    ctx.fill();
  };

  Renderer.prototype._fallingHere = function (col, r) {
    for (var i = 0; i < this.fallers.length; i++) {
      var f = this.fallers[i];
      if (f.col === col && !f.landed) {
        // 落点在目标行即视为该格
        var tr = Math.round((f.targetY - this.gridTop) / this.cell - 0.5);
        if (tr === r) return true;
      }
    }
    return false;
  };

  Renderer.prototype._paintPiece = function (col, r, p) {
    this._paintPieceAt(this.cx(col), this.cy(r), p, this.cell * 0.42);
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  Renderer.prototype._paintPieceAt = function (x, y, p, radius) {
    var ctx = this.ctx;
    var color = (p === 1) ? '#e63946' : '#2f6ff7';   // 红 / 蓝
    var light = (p === 1) ? '#ff8fa3' : '#8fc0ff';
    var dark = (p === 1) ? '#a6112a' : '#153f96';

    // 投影
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    // 球体（径向渐变模拟光泽）
    var g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    g.addColorStop(0, light);
    g.addColorStop(0.45, color);
    g.addColorStop(1, dark);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // 高光点
    ctx.beginPath();
    ctx.arc(x - radius * 0.32, y - radius * 0.38, radius * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();

    // 边缘勾线
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // 每次重绘（外部 state 变了调用）
  Renderer.prototype.render = function (board, opts) {
    this.board = board;
    if (opts && typeof opts.interactive === 'boolean') this.interactive = opts.interactive;
    // 同步缩放（窗口变化）
    this._resize();
    this._draw();
  };

  Renderer.prototype.clear = function () {
    this.fallers = [];
    this.board = null;
    this._draw();
  };

  global.C4Render = Renderer;
})(window);