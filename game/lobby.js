/* 联机等待室（所有游戏共用）：显示「我 / 对手」两个槽位、准备状态、房主开始按钮。
 * 服务端 room.js 在双方 hello 后下发 lobby { you, players, ready, started, host }。
 * 客户端只在 started=false 时显示本等待室；started 后由各自的 state 接管。
 */
(function () {
  'use strict';

  function GameLobby(opts) {
    this.root = document.getElementById('lobby');
    this.codeEl = document.getElementById('lobbyCode');
    this.statusEl = document.getElementById('lobbyStatus');
    this.seatEls = [document.getElementById('seat0'), document.getElementById('seat1')];
    this.btnReady = document.getElementById('btnReady');
    this.btnStart = document.getElementById('btnStart');
    this.btnLeave = document.getElementById('btnLeave');
    this.hintEl = document.getElementById('lobbyHint');
    this.you = -1;
    this.onReady = opts.onReady || function () {};
    this.onStart = opts.onStart || function () {};
    this.onLeave = opts.onLeave || function () {};
    var self = this;
    if (this.btnReady) this.btnReady.addEventListener('click', function () { self.onReady(); });
    if (this.btnStart) this.btnStart.addEventListener('click', function () { self.onStart(); });
    if (this.btnLeave) this.btnLeave.addEventListener('click', function () { self.onLeave(); });
  }

  GameLobby.prototype.show = function (code) {
    this.root.hidden = false;
    if (code) this.codeEl.textContent = code;
  };
  GameLobby.prototype.hide = function () { this.root.hidden = true; };

  GameLobby.prototype.setStatus = function (t, cls) {
    this.statusEl.textContent = t;
    this.statusEl.className = 'lobby-status' + (cls ? ' status--' + cls : '');
  };

  // d = { you, players:[bool,bool], ready:[bool,bool], started, host }
  GameLobby.prototype.render = function (d) {
    this.you = d.you;
    var you = d.you, other = 1 - you, self = this;
    [0, 1].forEach(function (i) {
      var seat = self.seatEls[i];
      if (!seat) return;
      var isYou = (i === you);
      var online = !!d.players[i];
      var ready = !!d.ready[i];
      seat.classList.toggle('is-you', isYou);
      seat.classList.toggle('is-online', online);
      seat.classList.toggle('is-ready', ready);
      var nameEl = seat.querySelector('.seat-name');
      var readyEl = seat.querySelector('.seat-ready');
      if (nameEl) nameEl.textContent = (isYou ? '我' : '对手') + '（玩家' + (i + 1) + '）';
      if (readyEl) readyEl.textContent = !online ? '离线' : (ready ? '已准备 ✓' : '未准备');
    });
    if (this.btnReady) this.btnReady.textContent = d.ready[you] ? '取消准备' : '准备';
    var canStart = (you === d.host) && d.players[0] && d.players[1] && d.ready[0] && d.ready[1];
    if (this.btnStart) {
      this.btnStart.disabled = !canStart;
      this.btnStart.textContent = (you === d.host) ? '开始游戏' : '等待房主开始…';
    }
    if (this.hintEl) {
      if (!d.players[other]) this.hintEl.textContent = (you === d.host ? '把房间码发给朋友，等他加入…' : '等待房主创建好…');
      else if (!d.ready[other]) this.hintEl.textContent = '等待对手准备…';
      else this.hintEl.textContent = (you === d.host ? '双方已准备，点击开始游戏' : '双方已准备，等待房主开始');
    }
  };

  window.GameLobby = GameLobby;
})();
