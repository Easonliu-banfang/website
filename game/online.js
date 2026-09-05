/* 联机层：封装 Cloudflare Worker 通信（建房间 / 加入 / WebSocket 同步）
 *
 * 加固项（应对国内 Cloudflare 不稳定）：
 *   - 心跳保活：每 25s 发一次 ping，远小于 Cloudflare 100s 空闲断开阈值
 *   - 自动重连：连接非正常断开后用指数退避重试（1s→2s→…→15s，封顶 8 次）
 *   - 状态回调：emit 'status' {state, detail} 给 UI 展示连接状态
 *
 * 部署时把 WORKER_BASE 改成你的 Worker 地址，例如：
 *   var WORKER_BASE = 'https://quoridor.your-subdomain.workers.dev';
 * 本地联调时保持 127.0.0.1:8787（与 `wrangler dev --port 8787` 对应）。
 */
(function () {
  'use strict';

  var WORKER_BASE = 'https://quoridor-mp.17721266011.workers.dev';
  var WS_BASE = WORKER_BASE.replace(/^http/, 'ws');

  var HEARTBEAT_MS = 25000;   // 心跳间隔，远小于 Cloudflare 100s 空闲断开
  var RECONNECT_BASE = 1000;  // 退避基数（毫秒）
  var RECONNECT_MAX = 15000;  // 单次最大退避
  var RECONNECT_CAP = 8;      // 最大重试次数，超出后停止并提示用户

  function Online() {
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

  // 广播连接状态给 UI
  Online.prototype._status = function (state, detail) {
    this._emit('status', { state: state, detail: detail || '' });
  };

  // 创建房间：返回 6 位房间码
  Online.prototype.createRoom = function () {
    var self = this;
    return fetch(WORKER_BASE + '/api/room', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) { self.code = d.code; return d.code; });
  };

  // 加入房间：查询状态与空位，拿到初始 state
  Online.prototype.joinRoom = function (code) {
    this.code = code;
    var self = this;
    return fetch(WORKER_BASE + '/api/room/' + code)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error === 'full' || !d.hasSpace) throw new Error('房间已满');
        if (!d.state) throw new Error('房间不存在');
        return d;
      });
  };

  // 建立 WebSocket，发 hello 领取自己的玩家编号，开始接收同步
  // preferred: 期望的玩家编号（0=红先手 / 1=紫后手），服务端按真实连接分配
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
      try { ws = new WebSocket(WS_BASE + '/api/room/' + self.code + '/ws'); }
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
        if (m.type === 'welcome') {
          self.player = m.player;
          self._emit('welcome', m.player);
          if (!settled) { settled = true; resolve(m.player); }
        }
        else if (m.type === 'state') self._emit('state', m.state);
        else if (m.type === 'players') self._emit('players', m.players);
        else if (m.type === 'req_undo') self._emit('req_undo');
        else if (m.type === 'res_undo') self._emit('res_undo', m.ok);
        else if (m.type === 'req_new') self._emit('req_new');
        else if (m.type === 'res_new') self._emit('res_new', m.ok);
        else if (m.type === 'error') self._emit('error', m.msg);
        else if (m.type === 'pong') { /* 心跳回包，忽略 */ }
      };
      ws.onclose = function () {
        self._stopHeartbeat();
        // 忽略已被新连接取代的旧 ws 的关闭事件
        if (self.ws !== ws) return;
        if (self._intentionalClose) { self._emit('close'); return; }
        self._scheduleReconnect();
      };
      ws.onerror = function () { self._emit('error', '连接异常'); };
    });
  };

  // 心跳：周期性发 ping，避免 Cloudflare 空闲断开
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

  // 指数退避重连
  Online.prototype._scheduleReconnect = function () {
    var self = this;
    if (this._intentionalClose) return;
    if (this._reconnectAttempts >= RECONNECT_CAP) {
      this._status('disconnected', '重连失败，请检查网络后刷新页面');
      return;
    }
    this._reconnectAttempts++;
    var delay = Math.min(RECONNECT_MAX, RECONNECT_BASE * Math.pow(2, this._reconnectAttempts - 1));
    this._status('reconnecting', '连接中断，' + (delay / 1000) + ' 秒后第 ' + this._reconnectAttempts + ' 次重连…');
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(function () { self._open(); }, delay);
  };

  // 手动重连（供 UI 「重试」按钮调用）
  Online.prototype.reconnect = function () {
    this._reconnectAttempts = 0;
    this._intentionalClose = false;
    this._open();
  };

  Online.prototype.sendMove = function (r, c) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'move', player: this.player, r: r, c: c }));
  };
  Online.prototype.sendWall = function (r, c, dir) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'wall', player: this.player, r: r, c: c, dir: dir }));
  };
  // 中继：把悔棋/重开 的请求或确认转给对手（服务端原样转发）
  Online.prototype.sendRelay = function (type, ok) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: type, player: this.player, ok: ok }));
  };
  // 重开：通知服务端重置权威棋局并广播
  Online.prototype.sendReset = function () {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'reset', player: this.player }));
  };
  Online.prototype.close = function () {
    this._intentionalClose = true;
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.ws = null;
  };

  window.QuoridorOnline = Online;
})();
