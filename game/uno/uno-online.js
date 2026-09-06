/* 匹配卡牌（UNO）联机客户端：创建(带模式)/加入/WebSocket 同步/心跳重连 */
(function (global) {
  'use strict';

  var WORKER_BASE = 'https://quoridor-mp.pages.dev';

  function fetchJSON(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || ('HTTP ' + r.status)); }, function () { throw new Error('HTTP ' + r.status); });
      return r.json();
    });
  }

  function UnoOnline() {
    this.code = null;
    this.ws = null;
    this.preferred = -1;
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._hbTimer = null;
    this._statusCb = null;
    this._msgCbs = {};
  }

  // 创建房间（带模式：2|3|4|2v2）
  UnoOnline.prototype.createRoom = function (mode) {
    var self = this;
    var q = mode ? '?game=uno&mode=' + encodeURIComponent(mode) : '?game=uno';
    return fetchJSON(WORKER_BASE + '/api/room' + q, { method: 'POST' })
      .then(function (d) { self.code = d.code; return d.code; });
  };

  // 加入房间：查询状态与空位
  UnoOnline.prototype.joinRoom = function (code) {
    this.code = code;
    return fetchJSON(WORKER_BASE + '/api/room/' + code).then(function (d) {
      if (d.error === 'full' || !d.hasSpace) throw new Error('房间已满');
      if (!d.state) throw new Error('房间不存在');
      return d;
    });
  };

  // 建立 WebSocket，发 hello 领取座位
  UnoOnline.prototype.connect = function (preferred) {
    var self = this;
    this.preferred = (preferred === 0 || preferred === 1) ? preferred : -1;
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }

    return new Promise(function (resolve, reject) {
      var ws;
      try { ws = new WebSocket(WORKER_BASE + '/api/room/' + self.code + '/ws'); }
      catch (e) { self._scheduleReconnect(); reject(e); return; }
      self.ws = ws;

      var settled = false;
      ws.onopen = function () {
        self._reconnectAttempts = 0;
        ws.send(JSON.stringify({ type: 'hello', player: self.preferred }));
        self._startHeartbeat();
        if (!settled) { settled = true; resolve(); }
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        var cbs = self._msgCbs[m.type];
        if (cbs) cbs.forEach(function (cb) { try { cb(m); } catch (err) {} });
      };
      ws.onclose = function () {
        self._stopHeartbeat();
        if (!self._intentionalClose) self._scheduleReconnect();
      };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    });
  };

  UnoOnline.prototype.on = function (type, cb) {
    if (!this._msgCbs[type]) this._msgCbs[type] = [];
    this._msgCbs[type].push(cb);
  };
  UnoOnline.prototype.send = function (obj) {
    if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch (e) {} }
  };
  UnoOnline.prototype.close = function () {
    this._intentionalClose = true;
    this._stopHeartbeat();
    try { if (this.ws) this.ws.close(); } catch (e) {}
  };

  // 心跳：服务端 15s 刷新 lastSeen（防死连接判定）
  UnoOnline.prototype._startHeartbeat = function () {
    var self = this;
    this._stopHeartbeat();
    this._hbTimer = setInterval(function () {
      if (self.ws && self.ws.readyState === 1) self.send({ type: 'ping' });
    }, 15000);
  };
  UnoOnline.prototype._stopHeartbeat = function () {
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = null; }
  };

  // 指数退避重连（封顶 30s）
  UnoOnline.prototype._scheduleReconnect = function () {
    var self = this;
    if (this._intentionalClose) return;
    if (this._reconnectTimer) return;
    this._reconnectAttempts++;
    var delay = Math.min(30000, 1500 * Math.pow(2, this._reconnectAttempts - 1));
    this._reconnectTimer = setTimeout(function () {
      self._reconnectTimer = null;
      self.connect(self.preferred).catch(function () {});
    }, delay);
  };

  global.UnoOnline = UnoOnline;
})(window);