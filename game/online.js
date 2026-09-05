/* 联机层：封装 Cloudflare Worker 通信（建房间 / 加入 / WebSocket 同步）
 *
 * 部署时把 WORKER_BASE 改成你的 Worker 地址，例如：
 *   var WORKER_BASE = 'https://quoridor.your-subdomain.workers.dev';
 * 本地联调时保持 127.0.0.1:8787（与 `wrangler dev --port 8787` 对应）。
 */
(function () {
  'use strict';

  var WORKER_BASE = 'https://quoridor-mp.17721266011.workers.dev';
  var WS_BASE = WORKER_BASE.replace(/^http/, 'ws');

  function Online() {
    this.code = null;
    this.player = -1;
    this.ws = null;
    this.h = {};
  }

  Online.prototype.on = function (type, fn) { this.h[type] = fn; return this; };
  Online.prototype._emit = function (type, data) { if (this.h[type]) this.h[type](data); };

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
  Online.prototype.connect = function (preferred) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var ws;
      try { ws = new WebSocket(WS_BASE + '/api/room/' + self.code + '/ws'); }
      catch (e) { reject(e); return; }
      self.ws = ws;
      ws.onopen = function () { ws.send(JSON.stringify({ type: 'hello', player: preferred })); };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.type === 'welcome') { self.player = m.player; self._emit('welcome', m.player); resolve(m.player); }
        else if (m.type === 'state') self._emit('state', m.state);
        else if (m.type === 'players') self._emit('players', m.players);
        else if (m.type === 'error') self._emit('error', m.msg);
      };
      ws.onclose = function () { self._emit('close'); };
      ws.onerror = function () { self._emit('error', '连接失败'); };
    });
  };

  Online.prototype.sendMove = function (r, c) {
    if (this.ws) this.ws.send(JSON.stringify({ type: 'move', player: this.player, r: r, c: c }));
  };
  Online.prototype.sendWall = function (r, c, dir) {
    if (this.ws) this.ws.send(JSON.stringify({ type: 'wall', player: this.player, r: r, c: c, dir: dir }));
  };
  Online.prototype.close = function () { if (this.ws) { try { this.ws.close(); } catch (e) {} } this.ws = null; };

  window.QuoridorOnline = Online;
})();
