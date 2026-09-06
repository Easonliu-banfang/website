/* 围棋联机层：封装 Cloudflare Worker 通信（建房间 / 加入 / WebSocket 同步）。
 * 与 GomokuOnline/BattleshipOnline 共用同一 Worker（quoridor-mp），通过 ?game=go&size=N 区分。
 * 服务端权威校验落子/提子/劫，并广播完整局面（围棋无隐藏信息）。
 * 消息协议（围棋）：
 *   hello {player}            → welcome {player} + 首份 state
 *   move  {player, r, c}      → 落子；服务端校验后广播 state
 *   pass  {player}            → 停一手；双方连续 pass 进入数子阶段
 *   reset {player}            → 新对局（双向确认：req_new / res_new 中继）
 */
(function () {
  'use strict';

  var WORKER_BASE = 'https://quoridor-mp.pages.dev';
  var WS_BASE = WORKER_BASE.replace(/^http/, 'ws');
  var GAME = 'go';
  var HTTP_TIMEOUT = 12000;

  var HEARTBEAT_MS = 15000;
  var RECONNECT_BASE = 1000;
  var RECONNECT_MAX = 30000;
  var RECONNECT_MAX_ATTEMPTS = 8;   // 重连上限：达到后停止自动重连，提示手动重试，避免一直显示"正在重连"

  function Online(size) {
    this.size = size || 19;
    this.code = null;
    this.player = -1;
    this.ws = null;
    this.h = {};
    this.preferred = -1;
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    this._hbTimer = null;
    this._reconnectTimer = null;
  }

  Online.prototype.on = function (type, fn) { this.h[type] = fn; return this; };
  Online.prototype._emit = function (type, data) { if (this.h[type]) this.h[type](data); };
  Online.prototype._status = function (state, detail) { this._emit('status', { state: state, detail: detail || '' }); };
  Online.prototype._wsSend = function (obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) {}
      return;
    }
    // 连接已断开：不再静默丢弃（否则按钮点了没反应），通知 UI 显示断线提示
    this._status('disconnected', '连接已断开，请重试');
  };

  function fetchJSON(url, opts) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(fn) { if (done) return; done = true; clearTimeout(timer); fn(); }
      var timer = setTimeout(function () {
        finish(function () { reject(new Error('连接超时。国内网络可能无法直连联机服务，可换个网络或开启代理后再试')); });
      }, HTTP_TIMEOUT);
      fetch(url, opts).then(function (r) {
        if (!r.ok) { finish(function () { reject(new Error('服务返回 ' + r.status)); }); return; }
        r.json().then(function (d) { finish(function () { resolve(d); }); },
          function () { finish(function () { reject(new Error('返回内容不是 JSON')); }); });
      }, function () {
        finish(function () { reject(new Error('网络不可达。国内直连联机服务可能受限，可换个网络或开启代理后再试')); });
      });
    });
  }

  Online.prototype.createRoom = function () {
    var self = this;
    return fetchJSON(WORKER_BASE + '/api/room?game=' + GAME + '&size=' + self.size, { method: 'POST' })
      .then(function (d) { self.code = d.code; return d.code; });
  };

  Online.prototype.joinRoom = function (code) {
    this.code = code;
    var self = this;
    return fetchJSON(WORKER_BASE + '/api/room/' + code + '?game=' + GAME + '&size=' + self.size)
      .then(function (d) {
        if (d.error === 'full' || !d.hasSpace) throw new Error('房间已满');
        if (!d.state) throw new Error('房间不存在');
        return d;
      });
  };

  Online.prototype.connect = function (preferred) {
    this.preferred = (preferred === 0 || preferred === 1) ? preferred : -1;
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    return this._open();
  };

  Online.prototype._open = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var ws;
      try { ws = new WebSocket(WS_BASE + '/api/room/' + self.code + '/ws?game=' + GAME + '&size=' + self.size); }
      catch (e) { self._scheduleReconnect(); reject(e); return; }
      self.ws = ws;
      self._status(self._reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
        self._reconnectAttempts > 0 ? ('第 ' + self._reconnectAttempts + ' 次重连…') : '');
      var settled = false;
      ws.onopen = function () {
        self._reconnectAttempts = 0;
        ws.send(JSON.stringify({ type: 'hello', player: self.preferred }));
        self._startHeartbeat();
        self._status('connected');
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.type === 'welcome') { self.player = m.player; self._emit('welcome', m.player); if (!settled) { settled = true; resolve(m.player); } }
        else if (m.type === 'lobby') { self._emit('lobby', m); if (m.started) self._emit('started'); }
        else if (m.type === 'started') self._emit('started');
        else if (m.type === 'state') self._emit('state', m.state);
        else if (m.type === 'players') self._emit('players', m.players);
        else if (m.type === 'req_new') self._emit('req_new');
        else if (m.type === 'res_new') self._emit('res_new', m.ok);
        else if (m.type === 'dissolve') { self._intentionalClose = true; self._stopHeartbeat(); self._emit('dissolve'); }
        else if (m.type === 'error') self._emit('error', m.msg);
        else if (m.type === 'pong') { }
        else if (m.type === 'ping') { self._wsSend({ type: 'pong' }); }
      };
      ws.onclose = function () {
        self._stopHeartbeat();
        if (self.ws !== ws) return;
        if (self._intentionalClose) { self._emit('close'); return; }
        self._scheduleReconnect();
      };
      ws.onerror = function () { self._emit('error', '连接异常'); };
    });
  };

  Online.prototype._startHeartbeat = function () {
    var self = this;
    this._stopHeartbeat();
    this._hbTimer = setInterval(function () {
      if (self.ws && self.ws.readyState === 1) { try { self.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {} }
    }, HEARTBEAT_MS);
  };
  Online.prototype._stopHeartbeat = function () {
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = null; }
  };
  Online.prototype._scheduleReconnect = function () {
    var self = this;
    if (this._intentionalClose) return;
    if (this._reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this._status('disconnected', '连接已断开，请点击「重新连接」重试');
      this._emit('giveup');
      return;
    }
    this._reconnectAttempts++;
    var delay = Math.min(RECONNECT_MAX, RECONNECT_BASE * Math.pow(2, this._reconnectAttempts - 1));
    this._status('reconnecting', '连接中断，' + (delay / 1000) + ' 秒后第 ' + this._reconnectAttempts + ' 次重连…');
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(function () { self._open(); }, delay);
  };
  Online.prototype.reconnect = function () { this._reconnectAttempts = 0; this._intentionalClose = false; this._open(); };

  // 等待室：切换准备状态
  Online.prototype.sendReady = function () { this._wsSend({ type: 'ready', player: this.player }); };
  // 等待室：房主开始游戏
  Online.prototype.sendStart = function (timing) { this._wsSend({ type: 'start', player: this.player, timing: timing || null }); };

  Online.prototype.sendMove = function (r, c) { this._wsSend({ type: 'move', player: this.player, r: r, c: c }); };
  Online.prototype.sendPass = function () { this._wsSend({ type: 'pass', player: this.player }); };
  Online.prototype.sendRelay = function (type, ok) { this._wsSend({ type: type, player: this.player, ok: ok }); };
  Online.prototype.sendReset = function () { this._wsSend({ type: 'reset', player: this.player }); };
  Online.prototype.sendLeave = function () {
    this._wsSend({ type: 'leave', player: this.player });
    this._intentionalClose = true;
    try { if (this.ws) this.ws.close(); } catch (e) {}
  };
  Online.prototype.close = function () {
    this._intentionalClose = true; this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.ws = null;
  };

  window.GoOnline = Online;
})();
