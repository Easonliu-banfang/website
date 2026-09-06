/* 匹配卡牌（UNO）联机客户端 —— 与五子棋/围棋/海战棋同构
 *  创建房间(带模式)/加入/建立 WS/心跳/有限重连/等待室(ready,start,notify,leave)
 *  对局动作：play(card) / draw / setColor / callUno / pass
 */
(function (global) {
  'use strict';

  var GAME = 'uno';
  var WS_BASE = 'https://quoridor-mp.pages.dev';
  var HEARTBEAT_MS = 15000;
  var RECONNECT_BASE = 1500;
  var RECONNECT_MAX = 30000;
  var RECONNECT_MAX_ATTEMPTS = 8;

  function fetchJSON(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || ('HTTP ' + r.status)); }, function () { throw new Error('HTTP ' + r.status); });
      return r.json();
    });
  }

  function Online() {
    this.code = null;
    this.ws = null;
    this.player = -1;
    this.preferred = -1;
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._hbTimer = null;
    this._cbs = {};
    this._statusCb = null;
  }

  // 创建房间（带模式：2|3|4|2v2）
  Online.prototype.createRoom = function (mode) {
    var self = this;
    var q = mode ? '?game=uno&mode=' + encodeURIComponent(mode) : '?game=uno';
    return fetchJSON(WS_BASE + '/api/room' + q, { method: 'POST' })
      .then(function (d) { self.code = d.code; return d.code; });
  };

  // 加入房间：查询状态与空位
  Online.prototype.joinRoom = function (code) {
    this.code = code;
    return fetchJSON(WS_BASE + '/api/room/' + code).then(function (d) {
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
      try { ws = new WebSocket(WS_BASE + '/api/room/' + self.code + '/ws?game=' + GAME); }
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
        else if (m.type === 'notify') self._emit('notify');
        else if (m.type === 'dissolve') { self._intentionalClose = true; self._stopHeartbeat(); self._emit('dissolve'); }
        else if (m.type === 'error') self._emit('error', m.msg);
        else if (m.type === 'pong') { /* 心跳回包 */ }
        else if (m.type === 'ping') { self.send({ type: 'pong' }); }
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
      if (self.ws && self.ws.readyState === 1) {
        try { self.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
      }
    }, HEARTBEAT_MS);
  };
  Online.prototype._stopHeartbeat = function () {
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = null; }
  };

  Online.prototype._scheduleReconnect = function () {
    var self = this;
    if (this._intentionalClose) return;
    if (this._reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this._status('disconnected', '连接已断开，请返回重试');
      this._emit('giveup');
      return;
    }
    this._reconnectAttempts++;
    var delay = Math.min(RECONNECT_MAX, RECONNECT_BASE * Math.pow(2, this._reconnectAttempts - 1));
    this._status('reconnecting', '连接中断，' + (delay / 1000) + ' 秒后第 ' + this._reconnectAttempts + ' 次重连…');
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(function () { self._open(); }, delay);
  };

  Online.prototype.reconnect = function () {
    this._reconnectAttempts = 0; this._intentionalClose = false; this._open();
  };

  // 等待室：切换准备状态
  Online.prototype.sendReady = function () { this.send({ type: 'ready', player: this.player }); };
  // 等待室：房主开始游戏
  Online.prototype.sendStart = function () { this.send({ type: 'start', player: this.player }); };
  Online.prototype.sendNotify = function () { this.send({ type: 'notify' }); };

  Online.prototype.sendLeave = function () {
    this.send({ type: 'leave', player: this.player });
    this._intentionalClose = true;
    try { if (this.ws) this.ws.close(); } catch (e) {}
  };
  Online.prototype.close = function () {
    this._intentionalClose = true; this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.ws = null;
  };

  // 对局动作（服务端权威）
  Online.prototype.sendPlay = function (card) { this.send({ type: 'play', card: card }); };
  Online.prototype.sendDraw = function () { this.send({ type: 'draw' }); };
  Online.prototype.sendSetColor = function (color) { this.send({ type: 'setColor', color: color }); };
  Online.prototype.sendCallUno = function () { this.send({ type: 'callUno' }); };
  Online.prototype.sendPass = function () { this.send({ type: 'pass' }); };
  Online.prototype.sendReset = function () { this.send({ type: 'reset', player: this.player }); };

  Online.prototype._wsSend = Online.prototype.send = function (obj) {
    if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch (e) {} }
    else this._emit('error', '连接已断开，请重试');
  };
  Online.prototype._status = function (phase, msg) {
    if (this._statusCb) { try { this._statusCb(phase, msg); } catch (e) {} }
  };
  Online.prototype.onStatus = function (cb) { this._statusCb = cb; };
  Online.prototype.on = function (type, cb) {
    if (!this._cbs[type]) this._cbs[type] = [];
    this._cbs[type].push(cb);
  };
  Online.prototype._emit = function (type, arg) {
    var cbs = this._cbs[type];
    if (cbs) cbs.forEach(function (cb) { try { cb(arg); } catch (e) {} });
  };

  global.UnoOnline = Online;
})(window);