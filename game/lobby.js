/* 联机房间（等待室）v3 —— 全屏房间布局（所有游戏共用）
 * 布局：左侧玩法预览（图+名+房间码），右侧 2×2 四座位卡片，底部状态+按钮条
 *   - 座位有人：显示「玩家 N」，右上圆点 已准备=绿✓ / 未准备=红⋯
 *   - 座位无人：灰色（保留玩家 N 占位）
 *   - 座位禁用（如双人游戏的下排）：灰底「未开放」
 *   - 房主：右下 [🔔 提醒准备] [开始游戏]；加入者：[准备/取消准备]；均有 [离开房间]
 * 服务端下发 lobby { you, players, ready, started, host }；started=true 后由 state 接管
 */
(function () {
  'use strict';

  function GameLobby(opts) {
    this.root = document.getElementById('lobby');
    this.codeEl = document.getElementById('lobbyCode');
    this.statusEl = document.getElementById('lobbyStatus');
    this.hintEl = document.getElementById('lobbyHint');
    this.seatEls = ['seat0', 'seat1', 'seat2', 'seat3'].map(function (id) { return document.getElementById(id); });
    this.btnReady = document.getElementById('btnReady');
    this.btnStart = document.getElementById('btnStart');
    this.btnNotify = document.getElementById('btnNotify');
    this.btnLeave = document.getElementById('btnLeave');
    this.you = -1;
    this.onReady = opts.onReady || function () {};
    this.onStart = opts.onStart || function () {};
    this.onNotify = opts.onNotify || function () {};
    this.onLeave = opts.onLeave || function () {};
    var self = this;
    if (this.btnReady) this.btnReady.addEventListener('click', function () { self.onReady(); });
    if (this.btnStart) this.btnStart.addEventListener('click', function () { self.onStart(); });
    if (this.btnNotify) this.btnNotify.addEventListener('click', function () { self.onNotify(); });
    if (this.btnLeave) this.btnLeave.addEventListener('click', function () { self.onLeave(); });
  }

  GameLobby.prototype.show = function (code) {
    if (this.root) this.root.hidden = false;
    if (code && this.codeEl) this.codeEl.textContent = code;
  };
  GameLobby.prototype.hide = function () { if (this.root) this.root.hidden = true; };

  GameLobby.prototype.setStatus = function (t, cls) {
    if (!this.statusEl) return;
    this.statusEl.textContent = t;
    this.statusEl.className = 'room-status' + (cls ? ' status--' + cls : '');
  };

  // 渲染一个座位：i=槽位(0-3)，occupied=是否有人，ready=是否已准备
  function renderSeat(seat, i, occupied, ready) {
    if (!seat) return;
    var name = seat.querySelector('.seat-name');
    var dot = seat.querySelector('.seat-dot');
    if (!name) return;
    seat.className = 'seat-card';
    if (!occupied) {
      seat.classList.add('empty');
      name.textContent = '玩家 ' + (i + 1);
      if (dot) { dot.textContent = ''; dot.classList.remove('ready', 'notready'); }
      return;
    }
    name.textContent = '玩家 ' + (i + 1);
    seat.classList.add(ready ? 'ready' : 'notready');
    if (dot) {
      dot.textContent = ready ? '✓' : '⋯';
      dot.classList.toggle('ready', !!ready);
      dot.classList.toggle('notready', !ready);
    }
  }

  // d = { you, players:[bool,bool], ready:[bool,bool], started, host }
  GameLobby.prototype.render = function (d) {
    this.you = d.you;
    var you = d.you, other = 1 - you, self = this;

    // 双人游戏：seat0/1 活跃；seat2/3 由 HTML 固定 disabled（未开放）
    for (var i = 0; i < 2; i++) {
      if (!self.seatEls[i]) continue;
      if (self.seatEls[i].classList.contains('disabled')) continue;
      renderSeat(self.seatEls[i], i, !!d.players[i], !!d.ready[i]);
    }

    var connected = (you >= 0);
    var isHost = (you === d.host);

    // 房主：显示 [提醒准备][开始游戏]；加入者：显示 [准备/取消准备]
    if (self.btnStart) {
      self.btnStart.hidden = !isHost;
      if (isHost) {
        var canStart = d.players[0] && d.players[1] && d.ready[0] && d.ready[1];
        self.btnStart.disabled = !canStart;
        self.btnStart.textContent = '开始游戏';
      }
    }
    if (self.btnNotify) self.btnNotify.hidden = !isHost;
    if (self.btnReady) {
      self.btnReady.hidden = isHost;
      if (!isHost) {
        self.btnReady.textContent = d.ready[you] ? '取消准备' : '准备';
        self.btnReady.disabled = !connected;
        if (!connected) self.btnReady.textContent = '连接中…';
      }
    }
    if (self.hintEl) {
      if (!d.players[other]) self.hintEl.textContent = (isHost ? '把房间码发给朋友，等他加入…' : '等待房主创建好…');
      else if (!d.ready[other]) self.hintEl.textContent = (isHost ? '对手未准备，可点「提醒准备」催一催' : '等待对手准备…');
      else self.hintEl.textContent = (isHost ? '双方已准备，点击开始游戏' : '双方已准备，等待房主开始');
    }
  };

  window.GameLobby = GameLobby;
})();