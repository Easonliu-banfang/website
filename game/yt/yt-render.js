/* 顶哪个羊 —— Canvas 渲染（赛道 / 羊 / 冷却 / 血量），支持时间插值平滑动画
 * 视角：己方（slot 0 或翻转视角）永远在左侧。
 */
(function (global) {
  'use strict';

  var ICON = ['', '🐑', '🐐', '🐏', '🐏'];
  var LV_NAME = ['', '小羊', '中羊', '大羊', '巨羊'];
  var LV_COLOR = ['', '#6fdc8e', '#6db5ff', '#f0b429', '#ff8a5c'];

  function Round(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = null;
    this.flip = (opts && opts.flip) || false;   // 是否左右翻转（guest 视角）
    this.lastTime = 0;
    this.shakeUntil = 0;
    this.resize();
  }

  Round.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(320, r.width | 0);
    this.h = Math.max(220, r.height | 0);
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Round.prototype.setView = function (v) {
    if (v && this.view && v.hp && this.view.hp) {
      // 血量骤降时轻微震屏，强化打击感
      var drop = (this.view.hp[0] - v.hp[0]) + (this.view.hp[1] - v.hp[1]);
      if (drop > 0 && (this.view.hp[0] - v.hp[0] !== 0 || this.view.hp[1] - v.hp[1] !== 0)) this.shakeUntil = Date.now() + 220;
    }
    this.view = v;
  };

  // 计算某只羊的当前显示位置（服务端 pos + 本地经过时间 × 速度）
  function currentPos(sh, view) {
    if (!view) return sh.pos;
    var dt = (Date.now() - (view.simAt || view.now || Date.now())) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 3) dt = 3;                    // 网络卡顿时不跳太远
    var p = sh.pos + dt * YT.SPEED;
    return Math.max(0, Math.min(YT.LEN, p));
  }

  Round.prototype.draw = function () {
    // 每帧检测容器尺寸变化（元素从 hidden 变为可见、窗口缩放等）
    var rr = this.canvas.getBoundingClientRect();
    if (rr.width > 0 && (Math.abs(rr.width - this.w) > 2 || Math.abs(rr.height - this.h) > 2)) this.resize();
    var ctx = this.ctx, v = this.view, W = this.w, H = this.h;
    ctx.clearRect(0, 0, W, H);
    if (!v) return;

    var shake = Date.now() < this.shakeUntil ? (Math.random() * 4 - 2) : 0;
    ctx.save();
    ctx.translate(shake, shake * 0.5);

    var padX = 26, padY = 34;
    var laneCount = v.lanes || 4;
    var fieldW = W - padX * 2, fieldH = H - padY * 2;
    var laneH = fieldH / laneCount;

    // ---- 基地（左=己方 绿，右=对手 红） ----
    function baseGrad(side) {
      var g = ctx.createLinearGradient(side === 0 ? padX : W - padX - 46, 0, side === 0 ? padX + 46 : W - padX, 0);
      if (side === 0) { g.addColorStop(0, 'rgba(34,197,94,0.35)'); g.addColorStop(1, 'rgba(34,197,94,0.02)'); }
      else { g.addColorStop(0, 'rgba(229,72,77,0.02)'); g.addColorStop(1, 'rgba(229,72,77,0.35)'); }
      return g;
    }
    ctx.fillStyle = baseGrad(0);
    ctx.fillRect(padX - 14, padY - 12, 60, fieldH + 24);
    ctx.fillStyle = baseGrad(1);
    ctx.fillRect(W - padX - 46, padY - 12, 60, fieldH + 24);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('我方基地', 10, padY - 16);
    ctx.textAlign = 'right';
    ctx.fillText('对方基地', W - 10, padY - 16);

    // ---- 赛道 ----
    var lanes = [];
    for (var i = 0; i < laneCount; i++) {
      var yTop = padY + i * laneH;
      lanes.push({ y: yTop + laneH / 2, i: i });
      // 赛道底纹
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.030)' : 'rgba(255,255,255,0.015)';
      ctx.fillRect(padX, yTop + 4, fieldW, laneH - 8);
      // 中线虚线
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(padX, yTop + laneH / 2);
      ctx.lineTo(padX + fieldW, yTop + laneH / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 赛道编号
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '800 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('赛道 ' + (i + 1), W / 2, yTop + 13);
    }

    // ---- 羊 ----
    var self = this;
    (v.sheep || []).forEach(function (sh) {
      var pos = currentPos(sh, v);                       // 0..100（从己方到对手）
      var laneIdx = self.flip ? (laneCount - 1 - sh.lane) : sh.lane;
      var lane = lanes[laneIdx];
      if (!lane) return;
      // 该羊所属方在屏幕上的左右：0=左（己方），1=右
      var sideIsLeft = (sh.slot === 0) !== self.flip;    // flip 时对手在左
      var t = sideIsLeft ? (pos / YT.LEN) : (1 - pos / YT.LEN);
      var x = padX + 18 + t * (fieldW - 36);
      var y = lane.y;

      // 阴影
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y + 16, 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // 羊身（圆形徽章 + emoji）
      var r = 13 + sh.lv * 2.4;
      var g = ctx.createRadialGradient(x - 4, y - 5, 3, x, y, r + 4);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, LV_COLOR[sh.lv] || '#ccc');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = sideIsLeft ? 'rgba(34,197,94,0.9)' : 'rgba(229,72,77,0.9)';
      ctx.stroke();

      ctx.font = (r * 1.25 | 0) + 'px system-ui, "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ICON[sh.lv] || '🐑', x, y + 1);

      // 等级角标
      ctx.fillStyle = 'rgba(10,14,20,0.85)';
      ctx.beginPath();
      ctx.arc(x + r - 3, y - r + 3, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = LV_COLOR[sh.lv] || '#fff';
      ctx.font = '800 11px monospace';
      ctx.fillText(String(sh.lv), x + r - 3, y - r + 4);
      ctx.textBaseline = 'alphabetic';
    });

    ctx.restore();
  };

  /* 主循环：由 app 启动（每帧重绘，位置用本地时间插值 → 平滑） */
  Round.prototype.start = function (getView) {
    var self = this;
    function loop() {
      if (self.stopped) return;
      self.setView(getView());
      self.draw();
      self.raf = requestAnimationFrame(loop);
    }
    loop();
  };
  Round.prototype.stop = function () { this.stopped = true; if (this.raf) cancelAnimationFrame(this.raf); };

  global.YTRender = { Round: Round, LV_NAME: LV_NAME, LV_COLOR: LV_COLOR, ICON: ICON, currentPos: currentPos };
})(typeof window !== 'undefined' ? window : globalThis);
