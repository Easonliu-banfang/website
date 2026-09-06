/* 规范大赛计时引擎（纯逻辑，无 DOM）。
 * 两种模式（大赛规范）：
 *   blitz 包干制：每方固定总时间，用完判负（五子棋/围棋通用）
 *   byo   读秒制：基本时限用完进入读秒，每次落子限时 byoMs，超时消耗一次读秒，
 *                读秒次数耗尽后超时判负（围棋大赛标准，如 10 分钟基本时限 + 3 次 30 秒读秒）
 * 本地/人机：客户端调用 onMove 结算；联机：服务端权威结算后广播 timing，客户端仅渲染。
 */
(function (global) {
  'use strict';

  var GameTimer = {
    // 创建计时状态。cfg: { mode:'off'|'blitz'|'byo', baseMs, byoCount, byoMs }
    create: function (cfg, turn) {
      var mode = cfg && cfg.mode ? cfg.mode : 'off';
      return {
        mode: mode,
        baseMs: (cfg && cfg.baseMs) || 0,
        byoCount: (cfg && cfg.byoCount) || 0,
        byoMs: (cfg && cfg.byoMs) || 0,
        remaining: [mode === 'off' ? 0 : ((cfg && cfg.baseMs) || 0), mode === 'off' ? 0 : ((cfg && cfg.baseMs) || 0)],
        byo: [(cfg && cfg.byoCount) || 0, (cfg && cfg.byoCount) || 0],
        turn: turn === 0 || turn === 1 ? turn : 0,
        lastAt: 0,
        active: false,
        winner: -1,   // 超时判负方（-1 = 未超时）
      };
    },

    // 开局启动（本地/人机用）；联机由服务端下发 timing，前端不调 start
    start: function (t, now) {
      if (!t || t.mode === 'off') return;
      t.active = true;
      t.lastAt = now;
    },

    // 一方走子后结算（本地/人机用）。moved=刚走完的一方（0/1）。返回是否超时判负。
    onMove: function (t, moved, now) {
      if (!t || t.mode === 'off') return -1;
      if (t.winner >= 0) return t.winner;
      var elapsed = now - t.lastAt;
      if (elapsed < 0) elapsed = 0;
      t.remaining[moved] -= elapsed;
      if (t.mode === 'blitz') {
        if (t.remaining[moved] < 0) { t.winner = moved; t.active = false; return moved; }
      } else if (t.mode === 'byo') {
        while (t.remaining[moved] < 0) {
          // 当前步预算耗尽 → 消耗一次读秒并重置为读秒预算；次数用尽则判负
          t.byo[moved] -= 1;
          if (t.byo[moved] < 0) { t.winner = moved; t.active = false; return moved; }
          t.remaining[moved] += t.byoMs;
        }
      }
      t.turn = 1 - moved;
      t.lastAt = now;
      return -1;
    },

    // 对局中轮询：返回超时方（-1 无）。前端渲染时钟时每帧调用。
    check: function (t, now) {
      if (!t || t.mode === 'off' || !t.active || t.winner >= 0) return -1;
      var elapsed = now - t.lastAt;
      if (elapsed < 0) elapsed = 0;
      if (t.mode === 'blitz') {
        if (t.remaining[t.turn] - elapsed < 0) return t.turn;
      } else if (t.mode === 'byo') {
        var rem = t.remaining[t.turn] - elapsed;
        if (rem < 0 && t.byo[t.turn] < 0) return t.turn; // 读秒次数已耗尽且当前步超时
      }
      return -1;
    },

    // 渲染快照：{ t0:{remaining,byo,running}, t1:{...}, winner }
    snapshot: function (t, now) {
      var s = { t0: { remaining: 0, byo: 0, running: false }, t1: { remaining: 0, byo: 0, running: false }, winner: -1 };
      if (!t || t.mode === 'off') return s;
      for (var i = 0; i < 2; i++) {
        var rem = t.remaining[i];
        var running = t.active && t.turn === i && t.winner < 0;
        if (running) {
          var elapsed = now - t.lastAt;
          if (elapsed > 0) rem -= elapsed;
        }
        s['t' + i].remaining = Math.max(0, rem);
        s['t' + i].byo = t.byo[i];
        s['t' + i].running = running;
      }
      s.winner = this.check(t, now);
      return s;
    },

    // 展示用格式化：ms -> "MM:SS" 或 "H:MM:SS"
    fmt: function (ms) {
      if (ms == null || ms < 0) ms = 0;
      var s = Math.ceil(ms / 1000);
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : pad(m) + ':' + pad(sec);
    },
  };

  global.GameTimer = GameTimer;
})(typeof window !== 'undefined' ? window : globalThis);
