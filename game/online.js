/* 联机层：封装 Cloudflare Worker 通信（建房间 / 加入 / WebSocket 同步）
 *
 * 加固项（应对国内 Cloudflare 不稳定）：
 *   - 心跳保活：每 25s 发一次 ping，远小于 Cloudflare 100s 空闲断开阈值
 *   - 自动重连：连接非正常断开后用指数退避重试（1s→2s→…→15s，封顶 8 次）
 *   - 状态回调：emit 'status' {state, detail} 给 UI 展示连接状态
 *
 * 关于 WORKER_BASE（重要）：
 *   `*.workers.dev` 这个域名在国内被 DNS 投毒（解析出非 Cloudflare 的假 IP），无代理时联机必失败；
 *   `*.pages.dev` 解析正常。所以这里指向 Cloudflare Pages 上的反向代理
 *   （worker/pages/functions/api/[[path]].js），由它在服务端再转发给真正的 Worker。
 * 若日后给 Worker 挂了自己的自定义域，把这里换成你的域名即可，其余代码不用动。
 */
(function () {
  'use strict';

  var WORKER_BASE = 'https://quoridor-mp.pages.dev';
  var WS_BASE = WORKER_BASE.replace(/^http/, 'ws');
  var HTTP_TIMEOUT = 12000;   // 建房间/加入的超时：被投毒或不可达时别让界面干等

  var HEARTBEAT_MS = 15000;   // 心跳间隔，远小于 Cloudflare 100s 空闲断开；同时作为服务端死连接检测的「存活信号」
  var RECONNECT_BASE = 1000;  // 退避基数（毫秒）
  var RECONNECT_MAX = 30000;  // 单次最大退避（封顶 30s）
  var RECONNECT_MAX_ATTEMPTS = 8;   // 重连上限：达到后停止自动重连，提示手动重试，避免一直显示"正在重连"

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

  // 仅当连接处于 OPEN 时发消息；失败静默忽略（连接抖动时调用方无需感知）
  Online.prototype._wsSend = function (obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) {}
      return;
    }
    // 连接已断开：不再静默丢弃（否则按钮点了没反应），通知 UI 显示断线提示
    this._status('disconnected', '连接已断开，请重试');
  };

  // 带超时的 JSON 请求：超时/不可达时给出中文原因，而不是让界面一直转圈
  function fetchJSON(url, opts) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(fn) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      }
      var timer = setTimeout(function () {
        finish(function () {
          reject(new Error('连接超时。国内网络可能无法直连联机服务，可换个网络或开启代理后再试'));
        });
      }, HTTP_TIMEOUT);

      fetch(url, opts).then(function (r) {
        if (!r.ok) {
          finish(function () { reject(new Error('服务返回 ' + r.status)); });
          return;
        }
        r.json().then(
          function (d) { finish(function () { resolve(d); }); },
          function () { finish(function () { reject(new Error('返回内容不是 JSON')); }); }
        );
      }, function () {
        finish(function () {
          reject(new Error('网络不可达。国内直连联机服务可能受限，可换个网络或开启代理后再试'));
        });
      });
    });
  }

  // 创建房间：返回 4 位数字房间码
  Online.prototype.createRoom = function () {
    var self = this;
    return fetchJSON(WORKER_BASE + '/api/room', { method: 'POST' })
      .then(function (d) { self.code = d.code; return d.code; });
  };

  // 加入房间：查询状态与空位，拿到初始 state
  Online.prototype.joinRoom = function (code) {
    this.code = code;
    var self = this;
    return fetchJSON(WORKER_BASE + '/api/room/' + code)
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
        else if (m.type === 'lobby') { self._emit('lobby', m); if (m.started) self._emit('started'); }
        else if (m.type === 'started') self._emit('started');
        else if (m.type === 'state') self._emit('state', m.state);
        else if (m.type === 'players') self._emit('players', m.players);
        else if (m.type === 'req_undo') self._emit('req_undo');
        else if (m.type === 'res_undo') self._emit('res_undo', m.ok);
        else if (m.type === 'notify') self._emit('notify');
        else if (m.type === 'req_new') self._emit('req_new');
        else if (m.type === 'res_new') self._emit('res_new', m.ok);
        else if (m.type === 'dissolve') { self._intentionalClose = true; self._stopHeartbeat(); self._emit('dissolve'); }
        else if (m.type === 'error') self._emit('error', m.msg);
        else if (m.type === 'pong') { /* 服务端心跳回包，忽略 */ }
        else if (m.type === 'ping') { self._wsSend({ type: 'pong' }); }  // 回应服务端心跳探测
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

  // 指数退避重连：封顶 30s、无限重试（不再因超过次数而放弃，避免「连不上就彻底卡死」）
  Online.prototype._scheduleReconnect = function () {
    var self = this;
    if (this._intentionalClose) return;
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

  Online.prototype.sendReady = function () { this._wsSend({ type: 'ready', player: this.player }); };
  Online.prototype.sendStart = function (timing) { this._wsSend({ type: 'start', player: this.player, timing: timing || null }); };
  Online.prototype.sendMove = function (r, c) {
    this._wsSend({ type: 'move', player: this.player, r: r, c: c });
  };
  Online.prototype.sendWall = function (r, c, dir) {
    this._wsSend({ type: 'wall', player: this.player, r: r, c: c, dir: dir });
  };
  // 中继：把悔棋/重开 的请求或确认转给对手（服务端原样转发）
  Online.prototype.sendRelay = function (type, ok) {
    this._wsSend({ type: type, player: this.player, ok: ok });
  };
  // 重开：通知服务端重置权威棋局并广播
  Online.prototype.sendReset = function () {
    this._wsSend({ type: 'reset', player: this.player });
  };
  Online.prototype.sendNotify = function () { this._wsSend({ type: 'notify' }); };

  Online.prototype.sendLeave = function () {
    this._wsSend({ type: 'leave', player: this.player });
    this._intentionalClose = true;
    try { if (this.ws) this.ws.close(); } catch (e) {}
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
