/* 各游戏分享元信息：名称 + 自制 SVG 图标（无 emoji） */
  var GAME_META = {
    qr:   { name: '步步为营', icon: svgQR() },
    gomoku: { name: '五子棋', icon: svgGomoku() },
    go:   { name: '围棋', icon: svgGo() },
    connect4: { name: '四子棋', icon: svgC4() },
    battleship: { name: '海战棋', icon: svgBS() },
    liar: { name: '骗子酒馆', icon: svgLiar() },
    uno:  { name: '优诺UNO！', icon: svgUno() },
    pool: { name: '八球台球', icon: svgPool() },
  };
  function detectGame() {
    var p = window.location.pathname;
    if (p.indexOf('/uno/') >= 0) return 'uno';
    if (p.indexOf('/liar/') >= 0) return 'liar';
    if (p.indexOf('gomoku') >= 0) return 'gomoku';
    if (p.indexOf('go-') >= 0 || p.indexOf('/go.') >= 0 || p.indexOf('go.html') >= 0) return 'go';
    if (p.indexOf('connect4') >= 0) return 'connect4';
    if (p.indexOf('battleship') >= 0) return 'battleship';
    if (p.indexOf('pool') >= 0) return 'pool';
    return 'qr';   // 步步为营 play.html/online.html 兜底
  }
  function svgPool() {
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="12" y="10" width="72" height="76" rx="9" fill="#4e3418"/>' +
      '<rect x="17" y="15" width="62" height="66" rx="5" fill="#12735a"/>' +
      '<g fill="#0a0d12"><circle cx="19" cy="17" r="5"/><circle cx="77" cy="17" r="5"/><circle cx="19" cy="79" r="5"/><circle cx="77" cy="79" r="5"/><circle cx="48" cy="17" r="5"/><circle cx="48" cy="79" r="5"/></g>' +
      '<circle cx="56" cy="48" r="9" fill="#f8c742"/><circle cx="66" cy="37" r="9" fill="#e63946"/>' +
      '<circle cx="66" cy="59" r="9" fill="#2f6ff7"/><circle cx="76" cy="48" r="9" fill="#1c2733"/>' +
      '<circle cx="31" cy="48" r="9" fill="#f3f6fa"/>' +
      '</svg>';
  }
  function svgUno() {
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="18" y="14" width="28" height="38" rx="6" fill="#ef4444"/><text x="32" y="42" font-size="22" font-weight="700" fill="#fff" text-anchor="middle" font-family="monospace">7</text>' +
      '<rect x="50" y="14" width="28" height="38" rx="6" fill="#3b82f6"/><text x="64" y="42" font-size="20" font-weight="700" fill="#fff" text-anchor="middle" font-family="monospace">+2</text>' +
      '<rect x="18" y="56" width="28" height="34" rx="6" fill="#f59e0b"/><text x="32" y="80" font-size="16" font-weight="700" fill="#fff" text-anchor="middle" font-family="monospace">J</text>' +
      '<rect x="50" y="56" width="28" height="34" rx="6" fill="#22c55e" transform="rotate(8 64 73)"/><text x="64" y="80" font-size="16" font-weight="700" fill="#fff" text-anchor="middle" font-family="monospace">&#187;&#187;</text>' +
      '</svg>';
  }
  function svgLiar() {
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="16" y="20" width="30" height="56" rx="5" fill="#1a2332" stroke="rgba(255,255,255,0.3)"/><text x="31" y="55" font-size="26" fill="#e6edf3" text-anchor="middle" font-family="monospace">&#9824;</text>' +
      '<rect x="50" y="20" width="30" height="56" rx="5" fill="#f8fafc" stroke="rgba(0,0,0,0.2)"/><text x="65" y="55" font-size="26" fill="#dc2626" text-anchor="middle" font-family="monospace">&#9829;</text>' +
      '</svg>';
  }
  function svgQR() {
    var cells = '', r, c;
    for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) cells += '<rect x="' + (24 + c * 18) + '" y="' + (24 + r * 18) + '" width="16" height="16" rx="2" fill="' + ((r + c) % 2 ? 'rgba(34,211,238,0.25)' : 'rgba(34,211,238,0.55)') + '"/>';
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' + cells +
      '<rect x="42" y="30" width="6" height="34" rx="1" fill="#a78bfa" transform="rotate(12 45 47)"/>' +
      '<circle cx="33" cy="33" r="5" fill="#e6edf3"/><circle cx="69" cy="69" r="5" fill="#0a0e14" stroke="#e6edf3"/>' +
      '</svg>';
  }
  function svgGomoku() {
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="14" y="14" width="68" height="68" rx="8" fill="#b4824b"/>' +
      '<line x1="14" y1="48" x2="82" y2="48" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>' +
      '<line x1="48" y1="14" x2="48" y2="82" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>' +
      '<circle cx="48" cy="48" r="11" fill="#0a0e14"/><circle cx="31" cy="31" r="11" fill="#f8fafc"/><circle cx="65" cy="65" r="11" fill="#0a0e14"/>' +
      '</svg>';
  }
  function svgGo() {
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="14" y="14" width="68" height="68" rx="8" fill="#d9a961"/>' +
      '<g stroke="rgba(0,0,0,0.3)" stroke-width="1.5">' +
      '<line x1="26" y1="26" x2="26" y2="70"/><line x1="48" y1="26" x2="48" y2="70"/><line x1="70" y1="26" x2="70" y2="70"/>' +
      '<line x1="26" y1="26" x2="70" y2="26"/><line x1="26" y1="48" x2="70" y2="48"/><line x1="26" y1="70" x2="70" y2="70"/></g>' +
      '<circle cx="26" cy="48" r="8" fill="#0a0e14"/><circle cx="70" cy="48" r="8" fill="#f8fafc"/>' +
      '</svg>';
  }
  function svgC4() {
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="14" y="20" width="68" height="56" rx="8" fill="#1d4ed8"/>' +
      '<circle cx="31" cy="37" r="9" fill="#ef4444"/><circle cx="48" cy="37" r="9" fill="#f8fafc"/><circle cx="65" cy="37" r="9" fill="#f59e0b"/>' +
      '<circle cx="31" cy="59" r="9" fill="#f8fafc"/><circle cx="48" cy="59" r="9" fill="#ef4444"/><circle cx="65" cy="59" r="9" fill="#22c55e"/>' +
      '</svg>';
  }
  function svgBS() {
    return '<svg viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg">' +
      '<g stroke="rgba(255,255,255,0.25)" stroke-width="1.5" fill="none">' +
      '<rect x="14" y="14" width="68" height="68" rx="6"/>' +
      '<line x1="37" y1="14" x2="37" y2="82"/><line x1="59" y1="14" x2="59" y2="82"/>' +
      '<line x1="14" y1="37" x2="82" y2="37"/><line x1="14" y1="59" x2="82" y2="59"/></g>' +
      '<rect x="16" y="39" width="42" height="16" rx="4" fill="#64748b"/>' +
      '<path d="M63 39 l17 17 M63 56 l17 -17" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>' +
      '</svg>';
  }

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
    this.minToStart = 0;     // 开局最少人数（0=跟 capacity 一致；骗子酒馆设 2 → 2-4 人灵活开局）
    this.readyState = false;   // 本地已知准备态（render 同步，点击乐观切换）
    this.onReady = opts.onReady || function () {};
    this.onStart = opts.onStart || function () {};
    this.onNotify = opts.onNotify || function () {};
    this.onLeave = opts.onLeave || function () {};
    this.shareExtra = opts.shareExtra || '';   // 分享链接附加查询参数（如匹配卡牌 &gm=4）
    // AI 补位（联机）：isAI/controls 来自 lobby 下发；onAddAI/onRemoveAI 由 app 提供（发 add_ai/remove_ai）
    this.isAI = null;          // [bool] 各槽位是否为 AI
    this.controls = null;      // [bool] 各槽位 AI 是否归本连接代打
    this._players = null;      // [bool] 各槽位是否有人（含 AI）
    this.started = false;
    this.onAddAI = opts.onAddAI || function () {};
    this.onRemoveAI = opts.onRemoveAI || function () {};
    this._aiFillActive = null; // 当前展开的空位/AI 槽位（避免重复弹出）
    var self = this;
    // 座位点击：空位 → 弹出「AI 补位」；自有的 AI 槽位 → 弹出「移除 AI」；点别处自动收起
    this.seatEls.forEach(function (seat, idx) {
      if (!seat) return;
      seat.addEventListener('click', function (e) {
        if (self._aiFillActive != null) return;     // 已展开，让 document 点击收起
        var i = idx;
        if (self.isAI && self.isAI[i] && self.controls && self.controls[i]) {
          self._showSeatAction(i, 'remove'); e.stopPropagation(); return;
        }
        if (self._canAddAI(i)) { self._showSeatAction(i, 'add'); e.stopPropagation(); }
      });
    });
    document.addEventListener('click', function () { self._hideSeatAction(); });
    if (this.btnReady) this.btnReady.addEventListener('click', function () {
      // 乐观更新：点击立即切换文字（服务端广播随后 render 校正，双保险避免“点了文字不变”）
      if (self.btnReady.disabled) return;   // 房主无准备按钮，点击无效
      self.readyState = !self.readyState;
      if (!self.btnReady.hidden) self.btnReady.textContent = self.readyState ? '取消准备' : '准备';
      self.onReady();
    });
    if (this.btnStart) this.btnStart.addEventListener('click', function () { self.onStart(); });
    if (this.btnNotify) this.btnNotify.addEventListener('click', function () { self.onNotify(); });
    if (this.btnLeave) this.btnLeave.addEventListener('click', function () { self.onLeave(); });
    if (this.btnShareLink) this.btnShareLink.addEventListener('click', function () {
      self.showShareModal();
    });
  }

  // ---------- 分享弹窗（所有游戏共用）----------
  // 构建/获取加入链接
  GameLobby.prototype.shareUrl = function () {
    var code = this.codeEl ? this.codeEl.textContent : '';
    return window.location.origin + window.location.pathname + '?mode=online&room=' + encodeURIComponent(code) + '&role=guest' + (this.shareExtra || '');
  };
  GameLobby.prototype.shareCopy = function (url, done) {
    function fallbackCopy(v) {
      var ta = document.createElement('textarea');
      ta.value = v; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url); done(); });
    } else { fallbackCopy(url); done(); }
  };
  GameLobby.prototype.showShareModal = function () {
    var self = this;
    var meta = GAME_META[detectGame()] || GAME_META.qr;
    var code = this.codeEl ? this.codeEl.textContent : '';
    var url = this.shareUrl();

    // 复用已存在的弹窗
    var mask = document.getElementById('shareModalMask');
    if (mask) { mask.parentNode.removeChild(mask); }
    mask = document.createElement('div');
    mask.id = 'shareModalMask';
    mask.className = 'share-mask';
    mask.innerHTML =
      '<div class="share-panel" role="dialog" aria-modal="true" aria-label="分享房间">' +
        '<button type="button" class="share-close" aria-label="关闭">&#215;</button>' +
        '<h2 class="share-title">请选择分享方式</h2>' +
        '<div class="share-game">' +
          '<div class="share-icon">' + meta.icon + '</div>' +
          '<div class="share-gname">' + meta.name + '</div>' +
          '<div class="share-room">房间号 <b>' + code + '</b></div>' +
        '</div>' +
        '<div class="share-btns">' +
          '<button type="button" class="share-btn ghost" id="shareCopyBtn">复制链接</button>' +
          '<button type="button" class="share-btn wx" id="shareWxBtn">转发给朋友</button>' +
        '</div>' +
        '<p class="share-hint" id="shareHint"></p>' +
      '</div>';
    document.body.appendChild(mask);

    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelector('.share-close').addEventListener('click', close);

    // 复制链接
    mask.querySelector('#shareCopyBtn').addEventListener('click', function () {
      self.shareCopy(url, function () {
        var hint = mask.querySelector('#shareHint');
        if (hint) hint.textContent = '链接已复制，去粘贴给朋友吧';
        if (window.Notify) window.Notify.show('邀请链接已复制', 'success');
      });
    });

    // 分享到微信：移动端调系统分享面板（可选拉微信）；桌面端复制 + 提示
    mask.querySelector('#shareWxBtn').addEventListener('click', function () {
      var hint = mask.querySelector('#shareHint');
      if (navigator.share) {
        navigator.share({
          title: '来一局 ' + meta.name,
          text: '房间号 ' + code + '，点击链接直接加入对战',
          url: url,
        }).then(function () {}).catch(function () {});
      } else {
        self.shareCopy(url, function () {
          if (hint) hint.textContent = '已复制链接，请打开微信粘贴发送给好友';
          if (window.Notify) window.Notify.show('已复制，请在微信中粘贴发送', 'success');
        });
      }
    });
  };

  // 设置房间人数容量（默认 2）。>2 时启用更多座位卡、提示文案按人数计算
  GameLobby.prototype.setCapacity = function (n) {
    this.capacity = (n === 3 || n === 4) ? n : 2;
    for (var i = 0; i < this.seatEls.length; i++) {
      if (!this.seatEls[i]) continue;
      if (i < this.capacity) this.seatEls[i].classList.remove('disabled');
      else this.seatEls[i].classList.add('disabled');
    }
  };

  // 开局最少人数（灵活开局用）：设 2 → 2 人即可开始（座位容量仍按 setCapacity）
  GameLobby.prototype.setMinToStart = function (n) {
    this.minToStart = n || 0;
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

  // 房间已入座人数（含 AI 占位）
  GameLobby.prototype._occupiedCount = function () {
    var n = 0, cap = this.capacity;
    for (var i = 0; i < cap; i++) if (this._players && this._players[i]) n++;
    return n;
  };
  // 该空位是否可补 AI：等待室 + 座位启用 + 空位 + 房间已有 ≥1 人（非空房）
  GameLobby.prototype._canAddAI = function (i) {
    if (this.started) return false;
    if (i >= this.capacity) return false;
    var seat = this.seatEls[i];
    if (!seat || seat.classList.contains('disabled')) return false;
    if (this._players && this._players[i]) return false;   // 已有人
    if (this.isAI && this.isAI[i]) return false;           // 已是 AI
    return this._occupiedCount() >= 1;
  };
  // 在座位中央弹出操作按钮（add=AI补位 / remove=移除AI）
  GameLobby.prototype._showSeatAction = function (i, type) {
    this._hideSeatAction();
    var seat = this.seatEls[i];
    if (!seat) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seat-ai-fill';
    btn.textContent = (type === 'remove') ? '移除 AI' : 'AI 补位';
    var self = this;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (type === 'remove') self.onRemoveAI(i); else self.onAddAI(i);
      self._hideSeatAction();
    });
    seat.appendChild(btn);
    this._aiFillActive = i;
  };
  GameLobby.prototype._hideSeatAction = function () {
    if (this._aiFillActive == null) return;
    var seat = this.seatEls[this._aiFillActive];
    if (seat) { var b = seat.querySelector('.seat-ai-fill'); if (b) b.parentNode.removeChild(b); }
    this._aiFillActive = null;
  };

  // 渲染一个座位：i=槽位(0-3)，d=完整 lobby 数据（含 players/ready/names/isAI）
  function renderSeat(seat, i, d) {
    if (!seat) return;
    var name = seat.querySelector('.seat-name');
    var dot = seat.querySelector('.seat-dot');
    if (!name) return;
    seat.className = 'seat-card';
    var isAI = !!(d.isAI && d.isAI[i]);
    var occupied = !!(d.players && d.players[i]) || isAI;
    if (!occupied) {
      seat.classList.add('empty');
      name.textContent = '玩家 ' + (i + 1);
      if (dot) { dot.textContent = ''; dot.classList.remove('ready', 'notready'); }
      return;
    }
    var pname = (d.names && d.names[i]) ? String(d.names[i]) : null;
    if (isAI) {
      // AI 占用的空位：显示 AI 名 + 绿点（AI 自动准备）
      seat.classList.add('ai-seat');
      name.textContent = (pname && pname !== 'null') ? pname : ('AI-' + (i + 1));
      if (dot) { dot.textContent = '✓'; dot.classList.add('ready'); dot.classList.remove('notready'); }
    } else {
      name.textContent = (pname && pname !== 'null') ? pname : ('玩家 ' + (i + 1));
      var ready = !!(d.ready && d.ready[i]);
      seat.classList.add(ready ? 'ready' : 'notready');
      if (dot) {
        dot.textContent = ready ? '✓' : '⋯';
        dot.classList.toggle('ready', !!ready);
        dot.classList.toggle('notready', !ready);
      }
    }
  }

  // d = { you, players:[bool], ready:[bool], started, host, names, isAI, controls }
  GameLobby.prototype.render = function (d) {
    this.you = d.you;
    var you = d.you, self = this;
    var cap = this.capacity;
    // 记录 AI 补位元数据（供座位点击判断）
    this.started = !!d.started;
    this.isAI = d.isAI || null;
    this.controls = d.controls || null;
    this._players = d.players || null;
    this._hideSeatAction();   // 每次重渲清空可能打开的补位弹层

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
      renderSeat(self.seatEls[i], i, d);
    }

    var connected = (you >= 0);
    var isHost = (you === d.host);

    // 在线索引与全员就绪判定（N 人通用）
    var onlineIdx = [];
    for (var k = 0; k < cap; k++) if (d.players && d.players[k]) onlineIdx.push(k);
    var needCount = (self.minToStart > 0) ? Math.min(self.minToStart, cap) : cap;   // 开局所需人数（liar=2 但 ≤容量）
    var readyAll = onlineIdx.length >= needCount && onlineIdx.every(function (x) { return !!(d.ready && d.ready[x]); });

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
      self.btnReady.disabled = isHost;      // 双保险：房主禁用准备按钮，即使显示也点不了
      if (!isHost) {
        self.readyState = !!d.ready[you];
        self.btnReady.textContent = self.readyState ? '取消准备' : '准备';
        self.btnReady.disabled = !connected;
        if (!connected) self.btnReady.textContent = '连接中…';
      }
    }
    if (self.hintEl) {
      var flexible = (self.minToStart > 0 && self.minToStart < cap);   // 灵活开局（如骗子酒馆 2-4 人）
      if (onlineIdx.length < needCount) {
        self.hintEl.textContent = flexible
          ? (isHost ? ('已入座 ' + onlineIdx.length + '/' + cap + ' 人（至少 ' + needCount + ' 人可开始），继续邀请或直接开始…') : ('已入座 ' + onlineIdx.length + '/' + cap + ' 人，等待房主开始…'))
          : (isHost ? '把房间码发给朋友，等待所有人加入…' : '等待房主创建好…');
      } else if (!readyAll) self.hintEl.textContent = (isHost ? '有人未准备，可点「提醒准备」催一催' : '等待所有人准备…');
      else self.hintEl.textContent = (isHost ? '全员已准备，点击开始游戏' : '全员已准备，等待房主开始');
    }
    // 座位 class 在 renderSeat 中被重置，重新应用队伍标签（2v2）
    if (self.seatTags) self.setSeatTags(self.seatTags);
  };

  window.GameLobby = GameLobby;
})();