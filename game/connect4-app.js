/* 四子棋交互层：三模式（local / ai / online），URL 驱动开局。
 * 渲染：竖版 Canvas（白架 + 红蓝棋 + 重力掉落动画）
 * 联机：统一等待室(GameLobby) → 开始 → 对局（服务端权威）
 */
(function () {
  'use strict';

  var G = window.Connect4;
  var boardCanvas = document.getElementById('board');
  var R = new window.C4Render(boardCanvas);

  var V = 'c1';

  var state = null;
  var mode = 'local';
  var vsAI = false;
  var aiSide = 2;          // AI 执蓝
  var myPlayer = 0;        // online: 服务端分配（0=红先 1=蓝后）；local/ai: 人类=0
  var humanColor = 1;      // 人类执子颜色（1 红 / 2 蓝）

  var online = null;
  var onlineMode = false;
  var connOk = false;
  var welcomed = false;
  var reqPending = false;
  var reqKind = null;
  var incomingKind = null;
  var wantNew = false;
  var resetSent = false;
  var roomStarted = false;   // 联机：等待室是否已开始
  var currentRoom = '';      // 联机房间码
  var lobby = null;          // GameLobby 实例

  var winTimer = null;
  var aiTimer = null;
  var coinLock = false;      // 抛硬币动画期间锁输入
  var coinShown = false;

  var el = {};
  ['boardTitle', 'btnNew', 'btnUndo', 'roomCodeTag', 'reqModal', 'reqText', 'reqSub',
   'btnReqOk', 'btnReqNo', 'coinModal', 'coin', 'coinTitle', 'coinResult', 'coinSub'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  function myColor() {
    if (onlineMode) {
      var bp = (state && typeof state.blackPlayer === 'number') ? state.blackPlayer : 0;
      return myPlayer === bp ? 1 : 2;
    }
    return humanColor;
  }
  function myTurn() {
    if (!state || state.winner >= 0 || coinLock) return false;
    if (onlineMode) return connOk && !reqPending && state.turn === myColor();
    if (mode === 'local') return true;          // 热座：当前回合方在该设备落子
    return state.turn === humanColor;           // ai：轮到人类
  }

  function hideBanner() { if (winTimer) { clearTimeout(winTimer); winTimer = null; } }
  // 结果一律走顶部通知栏（Notify），和其余游戏一致
  function showBanner(text, big, autoClose) {
    var isWin = /胜利|获胜|你赢了|恭喜/.test(text) && !/失败/.test(text);
    window.Notify.show(text, big ? (isWin ? 'win' : 'lose') : 'info', big ? { sticky: true } : undefined);
    if (winTimer) clearTimeout(winTimer);
    winTimer = null;
  }

  function newGame(ai) {
    vsAI = !!ai;
    state = G.createState();
    reqPending = false; reqKind = null; incomingKind = null; wantNew = false; resetSent = false;
    hideBanner();
    window.Notify.clearAll();
    if (!onlineMode) {
      var bp = Math.random() < 0.5 ? 0 : 1;      // 抛硬币：0=玩家一(人类)先, 1=玩家二(AI)先
      if (ai) { humanColor = bp === 0 ? 1 : 2; aiSide = 3 - humanColor; }
      state.blackPlayer = bp;                     // 前端本地也记录先手方
      syncUI();
      playCoin(bp, { ai: ai });
    }
    syncUI();
  }

  // 抛硬币决定先手（谁执红先行）：first = 先手玩家序号 0/1
  function playCoin(first, opts) {
    opts = opts || {};
    coinLock = true; coinShown = true;
    if (!el.coinModal) { coinLock = false; return; }
    el.coinModal.hidden = false;
    el.coin.classList.remove('flip', 'settled');
    el.coinTitle.textContent = '随机先手';
    el.coinResult.textContent = '';
    el.coinSub.textContent = '';
    void el.coin.offsetWidth;
    el.coin.classList.add('flip');
    setTimeout(function () {
      var firstLabel, sub;
      if (opts.ai) {
        firstLabel = first === 0 ? '🔴 你（红）先手' : '🔵 电脑（蓝）先手';
        sub = first === 0 ? '你执红，开始！' : '电脑执蓝，稍候…';
      } else if (opts.mode === 'online') {
        firstLabel = (first === myPlayer) ? '🔴 你（红）先手' : '🔵 对手（蓝）先手';
        sub = (first === myPlayer) ? '你执红，开始！' : '对手执红，你执蓝';
      } else {
        firstLabel = first === 0 ? '🔴 玩家一（红）先手' : '🔵 玩家二（蓝）先手';
        sub = first === 0 ? '玩家一执红先行' : '玩家二执蓝先行';
      }
      el.coinResult.textContent = firstLabel;
      el.coinSub.textContent = sub;
      el.coin.classList.add('settled');
    }, 1100);
    setTimeout(function () {
      el.coinModal.hidden = true;
      el.coin.classList.remove('flip', 'settled');
      coinLock = false;
      syncUI();
      if (opts.ai && state && state.winner < 0 && state.turn === aiSide) maybeAI();
    }, 2400);
  }

  // 落子：点列 → 引擎落子 → 触发重力动画
  function placeAt(col) {
    if (!myTurn() || reqPending) return;
    if (col < 0 || col >= G.COLS) return;
    if (!G.canDrop(state, col)) { showBanner('这一列已经堆满', false); return; }
    if (onlineMode) { online.sendDrop(col); return; }
    var color = (mode === 'local') ? state.turn : myColor();
    var res = G.drop(state, color, col);
    if (!res || !res.ok) return;
    // 重力动画：从顶部落到 res.row
    R.dropPiece(col, color, res.row);
    afterMove();
    syncUI();
  }

  function afterMove() {
    hideBanner();
    syncUI();
    if (state.winner >= 0) { onWin(state.winner); return; }
    maybeAI();
  }

  function onWin(winner) {
    var txt;
    if (onlineMode) {
      txt = winner === myColor() ? '🎉 你赢了！' : '对手获胜';
    } else if (vsAI) {
      txt = winner === humanColor ? '🎉 恭喜你胜利了！' : '😶 电脑获胜，再来一局？';
    } else {
      txt = (winner === 1 ? '🔴 红方' : '🔵 蓝方') + ' 获胜';
    }
    showBanner(txt, true, true);
    // 高亮胜利四连（简化为通知文案）
  }

  function maybeAI() {
    if (onlineMode || !vsAI || !state || state.winner >= 0) return;
    if (state.turn !== aiSide) return;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(function () {
      // AI 永远从中心列开局：空盘时优先 col3
      var col = window.Connect4AI.bestMove(state, aiSide);
      if (col == null) return;
      showBanner('电脑思考中…', false);
      var res = G.drop(state, aiSide, col);
      if (res && res.ok) R.dropPiece(col, aiSide, res.row);
      afterMove();
      syncUI();
    }, 550);
  }

  function doUndoLocal() {
    if (!onlineMode && G.undo(state)) {
      window.Notify.clearAll();
      syncUI();
    }
  }

  // 联机请求（悔棋/新局）双向确认 —— 沿用四款游戏的 req/res 协议
  function sendReq(kind) {
    if (!online || reqPending) return;
    reqPending = true; reqKind = kind;
    online.send({ type: 'req_' + kind });
    showBanner('已向对方请求' + (kind === 'undo' ? '悔棋' : '新局') + '，等待同意…', false);
  }
  function onIncomingReq(kind) {
    if (reqPending) return;
    reqPending = true; incomingKind = kind;
    el.reqText.textContent = (kind === 'undo' ? '对方请求悔棋' : '对方请求重开');
    el.reqModal.hidden = false;
  }
  function answerReq(ok) {
    el.reqModal.hidden = true;
    if (!online) return;
    online.send({ type: 'res_' + incomingKind, ok: ok });
    reqPending = false; incomingKind = null;
  }

  /* ---------- 渲染 ---------- */
  function turnLabel() {
    if (!state) return '';
    if (state.winner === 1) return '🔴 红方获胜！';
    if (state.winner === 2) return '🔵 蓝方获胜！';
    if (state.winner === 0) return '🤝 平局';
    return '轮到' + (state.turn === 1 ? '红' : '蓝') + '方落子';
  }
  function colorName(c) { return c === 1 ? '红' : '蓝'; }

  function syncUI() {
    if (!R) return;
    var board = state ? state.board : null;
    var interactive = !!state && state.winner < 0 && (onlineMode ? (myTurn() && connOk) : (mode === 'local' ? true : myTurn()));
    R.render(board, { interactive: interactive });
    if (el.boardTitle) {
      if (!state) el.boardTitle.textContent = '棋盘';
      else if (state.winner >= 0) el.boardTitle.textContent = (state.winner === 0 ? '🤝 平局' : (colorName(state.winner) + '方获胜'));
      else el.boardTitle.textContent = '🔴' + colorName(state.turn) + '方回合';
    }
    // 回合提示（Notify 一次性）
    if (state && state.winner < 0 && (onlineMode ? roomStarted : true)) {
      if (!coinLock) window.Notify.setTurn ? window.Notify.show(turnLabel(), 'info', { ttl: 2200 }) : null;
    }
    if (el.btnUndo) {
      el.btnUndo.disabled = !(!onlineMode && state && state.history.length > 0);
    }
  }

  // 鼠标：列悬停 + 点击落子
  function bindBoard() {
    boardCanvas.addEventListener('click', function (e) {
      var col = R.colFromEvent(e);
      if (col >= 0) placeAt(col);
    });
    boardCanvas.addEventListener('mousemove', function (e) {
      var col = R.colFromEvent(e);
      if (col !== R.hover) { R.setHover(col); if (state) syncUI(); }
    });
    boardCanvas.addEventListener('mouseleave', function () { R.setHover(null); });
  }

  /* ---------- 联机事件 ---------- */
  function bindOnline(o) {
    o.onStatus(function (phase) {
      if (!window.Notify) return;
      if (phase === 'connected') window.Notify.show('已连接', 'success');
      else if (phase === 'reconnecting') window.Notify.show('连接中断，正在重连…', 'warn', { sticky: true });
      else if (phase === 'disconnected') window.Notify.show('连接已断开', 'error', { sticky: true });
    });
    o.on('welcome', function () {
      if (lobby) { lobby.show(currentRoom); lobby.setStatus('已连接，等待准备开始', 'connected'); }
    });
    o.on('lobby', function (d) {
      myPlayer = d.you;
      var fromGame = roomStarted;
      roomStarted = !!d.started;
      if (lobby) {
        if (d.started) { window.Notify.clear('🔔 房主提醒你准备'); lobby.hide(); }
        else {
          if (fromGame && state) {
            state = null;
            window.Notify.clearAll();
            window.Notify.show('对局已结束（对方退出/掉线），返回房间', 'warn', { sticky: true });
          }
          lobby.show(currentRoom); lobby.render(d);
        }
      }
    });
    o.on('started', function () { roomStarted = true; if (lobby) lobby.hide(); });
    o.on('state', function (s) {
      var prev = state;
      state = s;
      myPlayer = s.you; connOk = true; roomStarted = true;
      if (lobby) lobby.hide();
      if (reqKind === 'undo') { reqKind = null; reqPending = false; }
      // 新局（开局或重开 _broadcast history=0）：清通知 + 播硬币
      if (s.history.length === 0) {
        window.Notify.clearAll();
        if (prev && prev.history.length > 0) coinShown = false;   // 重开：复位硬币标志
        if (!coinShown) { playCoin(s.blackPlayer, { mode: 'online' }); return; }  // 硬币动画中不 syncUI
      } else if (!coinLock && s.last) {
        // 对手落子：触发重力动画（对比 last）
        var lastCol = s.last[1];
        var lp = s.history[s.history.length - 1].p;
        R.dropPiece(lastCol, lp, s.last[0]);
        setTimeout(syncUI, 30);
      }
      if (s.winner >= 0) onWin(s.winner);
      syncUI();
    });
    o.on('players', function () { if (roomStarted && state) syncUI(); });
    o.on('notify', function () { if (window.Notify) window.Notify.show('🔔 房主提醒你准备', 'warn', { sticky: true }); });
    o.on('error', function (msg) { if (msg) showBanner(msg, false); });
    o.on('req_undo', function () { onIncomingReq('undo'); });
    o.on('res_undo', function (ok) {
      // 服务端已在 res_undo=ok 时执行 engine undo，这里仅清状态并提示
      reqPending = false; reqKind = null;
      showBanner(ok ? '对方同意悔棋' : '对方拒绝悔棋', false);
    });
    o.on('req_new', function () { onIncomingReq('new'); });
    o.on('res_new', function (ok) {
      reqPending = false; wantNew = false;
      if (ok) {
        if (!resetSent) { resetSent = true; if (online) online.sendReset(); }
        showBanner('已同意重开，重置中…', false);
      } else {
        showBanner('对方拒绝了重开', false);
      }
    });
    o.on('dissolve', function () {
      roomStarted = false;
      if (online) online._intentionalClose = true;
      if (lobby) lobby.hide();
      if (window.Notify) {
        window.Notify.clearAll();
        window.Notify.show('房间已解散（有玩家离开），即将返回大厅…', 'error', { sticky: true });
      }
      setTimeout(function () { location.href = 'connect4-online.html?v=b10'; }, 1800);
    });
    o.on('giveup', function () {
      if (window.Notify) {
        window.Notify.clearAll();
        window.Notify.show('多次重连失败，返回房间…', 'warn', { sticky: true });
      }
      if (online) online._intentionalClose = true;
      setTimeout(function () { location.href = 'connect4-online.html?v=b10'; }, 1500);
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var q = {};
    location.search.replace(/[?&]([^=]+)=([^&]*)/g, function (_, k, v) { q[k] = decodeURIComponent(v); });
    if (window.innerWidth < window.innerHeight && q.mode === 'online') {
      document.body.classList.add('portrait-block');
    }

    bindBoard();
    ['btnNew', 'btnUndo'].forEach(function (id) {
      if (el[id]) el[id].addEventListener('click', function () { if (id === 'btnNew') { if (onlineMode) sendReq('new'); else { newGame(vsAI); } } else if (id === 'btnUndo') { if (onlineMode) sendReq('undo'); else doUndoLocal(); } });
    });
    if (el.btnReqOk) el.btnReqOk.addEventListener('click', function () { answerReq(true); });
    if (el.btnReqNo) el.btnReqNo.addEventListener('click', function () { answerReq(false); });

    if (q.mode === 'local') {
      mode = 'local'; vsAI = false;
      newGame(false);
    } else if (q.mode === 'ai') {
      mode = 'ai'; vsAI = true;
      newGame(true);
    } else if (q.mode === 'online' && q.room) {
      mode = 'online'; onlineMode = true; myPlayer = q.role === 'host' ? 0 : -1;
      roomStarted = false; currentRoom = q.room;
      state = G.createState();
      if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + currentRoom; el.roomCodeTag.hidden = false; }
      syncUI();
      online = new window.Connect4Online();
      online.code = currentRoom;
      lobby = new window.GameLobby({
        onReady: function () { if (online) online.sendReady(); },
        onStart: function () { if (online) online.sendStart(); },
        onNotify: function () { if (online) online.sendNotify(); if (window.Notify) window.Notify.show('已提醒对方准备', 'info'); },
        onLeave: function () { if (online) online.sendLeave(); location.href = 'connect4.html'; }
      });
      lobby.show(currentRoom);
      lobby.setStatus('连接中…', 'connecting');
      bindOnline(online);
      online.connect(q.role === 'host' ? 0 : 1).catch(function () {
        if (window.Notify) window.Notify.show('连接失败，正在重连…', 'warn', { sticky: true });
      });
    } else {
      location.href = 'connect4.html';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();