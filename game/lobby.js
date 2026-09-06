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
    this.btnShareLink = document.getElementById('btnShareLink');
    this.you = -1;
    this.capacity = 2;       // 房间人数容量（默认双人；匹配卡牌 3/4/2v2 由 app 设置）
    this.readyState = false;   // 本地已知准备态（render 同步，点击乐观切换）
    this.onReady = opts.onReady || function () {};
    this.onStart = opts.onStart || function () {};
    this.onNotify = opts.onNotify || function () {};
    this.onLeave = opts.onLeave || function () {};
    this.shareExtra = opts.shareExtra || '';   // 分享链接附加查询参数（如匹配卡牌 &gm=4）
    var self = this;
    if (this.btnReady) this.btnReady.addEventListener('click', function () {
      // 乐观更新：点击立即切换文字（服务端广播随后 render 校正，双保险避免“点了文字不变”）
      self.readyState = !self.readyState;
      if (!self.btnReady.hidden) self.btnReady.textContent = self.readyState ? '取消准备' : '准备';
      self.onReady();
    });
    if (this.btnStart) this.btnStart.addEventListener('click', function () { self.onStart(); });
    if (this.btnNotify) this.btnNotify.addEventListener('click', function () { self.onNotify(); });
    if (this.btnLeave) this.btnLeave.addEventListener('click', function () { self.onLeave(); });
    if (this.btnShareLink) this.btnShareLink.addEventListener('click', function () {
      // 分享加入链接：当前页 ?mode=online&room=ROOM&role=guest（可带 shareExtra 如 &gm=4），对方点开直接以加入方进入
      var code = self.codeEl ? self.codeEl.textContent : '';
      var url = location.origin + location.pathname + '?mode=online&room=' + encodeURIComponent(code) + '&role=guest' + (self.shareExtra || '');
      function done() { if (window.Notify) window.Notify.show('邀请链接已复制，发给朋友即可直接加入', 'success'); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url); done(); });
      else { fallbackCopy(url); done(); }
      function fallbackCopy(v) { var ta = document.createElement('textarea'); ta.value = v; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
    });
  }

  // 设置房间人数容量（默认 2）。>2 时启用更多座位卡、提示文案按人数计算
  GameLobby.prototype.setCapacity = function (n) {
    this.capacity = (n === 3 || n === 4) ? n : 2;
    for (var i = 0; i < this.seatEls.length; i++) {
      if (!this.seatEls[i]) continue;
      if (i < this.capacity) this.seatEls[i].classList.remove('disabled');
      else this.seatEls[i].classList.add('disabled');
    }
  };

  // 队伍标签（2v2 上下两排一队）：传入每座文字数组，如 ['下排','下排','上排','上排']（留 null 表示无）
  GameLobby.prototype.setSeatTags = function (tags) {
    this.seatTags = tags || null;
    for (var i = 0; i < this.seatEls.length; i++) {
      if (!this.seatEls[i]) continue;
      var tag = this.seatEls[i].querySelector('.seat-tag');
      if (!tag) continue;
      var txt = (this.seatTags && this.seatTags[i]) ? this.seatTags[i] : '';
      tag.textContent = txt;
      tag.classList.toggle('team-a', txt === '下排');
      tag.classList.toggle('team-b', txt === '上排');
    }
  };

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

  // d = { you, players:[bool], ready:[bool], started, host }
  GameLobby.prototype.render = function (d) {
    this.you = d.you;
    var you = d.you, self = this;
    var cap = this.capacity;

    // 渲染全部座位（最多 4 人）；HTML disabled 的座位保持「未开放」，超出容量的座位显示未开放
    for (var i = 0; i < self.seatEls.length; i++) {
      if (!self.seatEls[i]) continue;
      if (self.seatEls[i].classList.contains('disabled')) continue;
      if (i >= self.capacity) {
        self.seatEls[i].classList.add('disabled');
        var dname = self.seatEls[i].querySelector('.seat-name');
        if (dname) dname.textContent = '未开放';
        continue;
      }
      renderSeat(self.seatEls[i], i, !!(d.players && d.players[i]), !!(d.ready && d.ready[i]));
    }

    var connected = (you >= 0);
    var isHost = (you === d.host);

    // 在线索引与全员就绪判定（N 人通用）
    var onlineIdx = [];
    for (var k = 0; k < cap; k++) if (d.players && d.players[k]) onlineIdx.push(k);
    var readyAll = onlineIdx.length >= cap && onlineIdx.every(function (x) { return !!(d.ready && d.ready[x]); });

    // 房主：显示 [提醒准备][开始游戏]；加入者：显示 [准备/取消准备]
    if (self.btnStart) {
      self.btnStart.hidden = !isHost;
      if (isHost) {
        // 开始条件：在线人数达到容量 且 所有在线玩家都已准备（支持 N 人）
        self.btnStart.disabled = !readyAll;
        self.btnStart.textContent = '开始游戏';
      }
    }
    if (self.btnNotify) self.btnNotify.hidden = !isHost;
    if (self.btnReady) {
      self.btnReady.hidden = isHost;
      if (!isHost) {
        self.readyState = !!d.ready[you];
        self.btnReady.textContent = self.readyState ? '取消准备' : '准备';
        self.btnReady.disabled = !connected;
        if (!connected) self.btnReady.textContent = '连接中…';
      }
    }
    if (self.hintEl) {
      if (onlineIdx.length < cap) self.hintEl.textContent = (isHost ? '把房间码发给朋友，等待所有人加入…' : '等待房主创建好…');
      else if (!readyAll) self.hintEl.textContent = (isHost ? '有人未准备，可点「提醒准备」催一催' : '等待所有人准备…');
      else self.hintEl.textContent = (isHost ? '全员已准备，点击开始游戏' : '全员已准备，等待房主开始');
    }
    // 座位 class 在 renderSeat 中被重置，重新应用队伍标签（2v2）
    if (self.seatTags) self.setSeatTags(self.seatTags);
  };

  window.GameLobby = GameLobby;
})();