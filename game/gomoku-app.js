/* 五子棋交互层：落子 + 三模式（local / ai / online），URL 驱动开局。
 * 渲染：单块 Canvas（棋盘+棋子），沿用「服务端权威、本地整体替换」思路。
 */
(function () {
  'use strict';

  var G = window.Gomoku;
  var boardCanvas = document.getElementById('board');
  var R = new window.GRender(boardCanvas);

  var V = 'g2';

  var state = null;
  var mode = 'local';
  var vsAI = false;
  var aiSide = 2;          // AI 执白
  var myPlayer = 0;        // online: 服务端分配（0=黑 1=白）；local/ai: 人类=0(黑)
  var humanColor = 1;      // 人类执子颜色（1 黑 / 2 白）

  var online = null;
  var onlineMode = false;
  var connOk = false;
  var welcomed = false;
  var reqPending = false;
  var reqKind = null;
  var incomingKind = null;
  var wantNew = false;
  var resetSent = false;
  var roomStarted = false;   // 联机：等待室是否已开始（false=等待室，true=对局中）
  var currentRoom = '';      // 联机房间码
  var lobby = null;          // GameLobby 实例

  var winTimer = null;
  var aiTimer = null;
  var hover = null;

  var el = {};
  ['turnLabel', 'phaseLabel', 'boardTitle', 'btnNew', 'onlineStatus', 'roomCodeTag',
   'reqModal', 'reqText', 'reqSub', 'btnReqOk', 'btnReqNo', 'banner'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  function myColor() {
    if (onlineMode) return myPlayer === 0 ? 1 : 2;
    return humanColor;
  }
  function myTurn() {
    if (!state || state.winner >= 0) return false;
    if (onlineMode) return connOk && !reqPending && state.turn === myColor();
    if (mode === 'local') return true;          // 热座：当前回合方就在本设备落子
    return state.turn === humanColor;  // ai：轮到人类
  }

  function hideBanner() {
    el.banner.classList.remove('show', 'big');
    if (winTimer) { clearTimeout(winTimer); winTimer = null; }
  }
  function showBanner(text, big, autoClose) {
    el.banner.textContent = text;
    el.banner.classList.toggle('big', !!big);
    el.banner.classList.add('show');
    if (winTimer) clearTimeout(winTimer);
    if (autoClose) winTimer = setTimeout(hideBanner, 3200); else winTimer = null;
  }

  function newGame(ai) {
    vsAI = !!ai;
    state = G.createState();
    reqPending = false; reqKind = null; incomingKind = null; wantNew = false; resetSent = false;
    hover = null;
    hideBanner();
    el.phaseLabel.textContent = '对局进行中';
    syncUI();
  }

  function placeAt(r, c) {
    if (!myTurn()) return;
    if (onlineMode) {
      online.sendMove(r, c);
      return;
    }
    // 本地热座：用当前回合方颜色落子（不绑定人类身份）
    var color = (mode === 'local') ? state.turn : myColor();
    var res = G.place(state, color, r, c);
    if (!res) return;
    afterMove();
  }

  function afterMove() {
    hideBanner();
    syncUI();
    if (state.winner >= 0) { onWin(state.winner); return; }
    maybeAI();
  }

  function onWin(winner) {
    if (onlineMode) {
      showBanner(winner === myColor() ? '🎉 你赢了！' : '对手获胜', true);
    } else if (vsAI) {
      showBanner(winner === humanColor ? '🎉 恭喜你胜利了！' : '😶 电脑获胜，再来一局？', true, true);
    } else {
      showBanner((winner === 1 ? '黑棋' : '白棋') + ' 获胜', true);
    }
  }

  function maybeAI() {
    if (onlineMode || !vsAI || !state || state.winner >= 0) return;
    if (state.turn !== aiSide) return;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(function () {
      if (!state || state.winner >= 0 || state.turn !== aiSide) return;
      var mv = window.GomokuAI.nextMove(state, aiSide);
      if (!mv) return;
      var res = G.place(state, aiSide, mv[0], mv[1]);
      if (!res) { maybeAI(); return; }
      hideBanner(); syncUI();
      if (state.winner >= 0) { onWin(state.winner); return; }
      syncUI();
    }, 500);
  }

  /* ---------- 联机事件 ---------- */
  function showOnlineStatus(msg, cls) {
    if (!el.onlineStatus) return;
    el.onlineStatus.textContent = msg;
    el.onlineStatus.className = 'status' + (cls ? ' status--' + cls : '');
  }

  function fromView(v) {
    return {
      size: v.size, board: v.board, turn: v.turn, winner: v.winner,
      last: v.last || null, history: v.history || []
    };
  }

  function bindOnline(o) {
    o.on('welcome', function (p) {
      welcomed = true; myPlayer = p; connOk = true;
      humanColor = p === 0 ? 1 : 2;
      if (!roomStarted) {
        if (lobby) { lobby.show(currentRoom); lobby.setStatus('已连接，等待双方准备', 'connected'); }
        showOnlineStatus('已进入房间，等待准备开始', 'connected');
      }
      syncUI();
    });
    o.on('lobby', function (d) {
      myPlayer = d.you; connOk = true;
      roomStarted = !!d.started;
      if (lobby) {
        if (d.started) lobby.hide();
        else { lobby.show(currentRoom); lobby.render(d); }
      }
    });
    o.on('started', function () { roomStarted = true; if (lobby) lobby.hide(); });
    o.on('dissolve', function () {
      roomStarted = false;
      if (online) online._intentionalClose = true;
      if (lobby) lobby.hide();
      showOnlineStatus('房间已解散（有玩家离开），即将返回大厅…', 'disconnected');
      setTimeout(function () { location.href = 'gomoku-online.html'; }, 1800);
    });
    o.on('state', function (v) {
      state = fromView(v);
      myPlayer = v.you; connOk = true; roomStarted = true;
      if (lobby) lobby.hide();
      if (state.winner >= 0) onWin(state.winner);
      syncUI();
    });
    o.on('players', function (ps) {
      if (roomStarted) return;
      var opp = !!(ps[1 - myPlayer]);
      if (lobby) lobby.setStatus(opp ? '双方已就位，准备开始' : '等待对手加入…', opp ? 'connected' : 'connecting');
    });
    o.on('req_new', function () {
      reqPending = true; incomingKind = 'new';
      if (el.reqText) el.reqText.textContent = '对方请求重开一局';
      if (el.reqSub) el.reqSub.textContent = '同意后棋局将重置';
      if (el.reqModal) el.reqModal.hidden = false;
      syncUI();
    });
    o.on('res_new', function (ok) {
      reqPending = false; wantNew = false;
      if (ok) {
        if (!resetSent) { resetSent = true; online.sendReset(); }
        showOnlineStatus('已同意重开，重置中…', 'connecting');
      } else showOnlineStatus('对方拒绝了重开', 'disconnected');
      syncUI();
    });
    o.on('status', function (s) {
      if (s.state === 'connecting') { connOk = false; showOnlineStatus('连接中…', 'connecting'); }
      else if (s.state === 'connected') { connOk = true; if (myPlayer < 0) showOnlineStatus('已连接', 'connected'); }
      else if (s.state === 'reconnecting') { connOk = false; showOnlineStatus(s.detail || '连接中断，重连中…', 'reconnecting'); }
      else if (s.state === 'disconnected') { connOk = false; showOnlineStatus(s.detail || '连接已断开', 'disconnected'); }
      syncUI();
    });
    o.on('error', function (msg) { showOnlineStatus('错误：' + msg, 'disconnected'); });
    o.on('close', function () { connOk = false; showOnlineStatus('连接已断开', 'disconnected'); });
  }

  function requestNew() {
    if (reqPending || !state) return;
    reqPending = true; reqKind = 'new'; incomingKind = null; wantNew = true;
    if (onlineMode) { online.sendRelay('req_new'); showOnlineStatus('已发送重开请求，等待对方确认…', 'connecting'); }
    else { beginNew(); }
    syncUI();
  }
  function respondNew(ok) {
    incomingKind = null; if (el.reqModal) el.reqModal.hidden = true;
    if (onlineMode) { online.sendRelay('res_new', ok); reqPending = false; wantNew = false;
      if (ok) showOnlineStatus('已同意重开，等待重置…', 'connecting'); else showOnlineStatus('已拒绝对方重开', 'disconnected'); }
    else { beginNew(); }
    syncUI();
  }
  function beginNew() {
    if (onlineMode) { showOnlineStatus('等待服务端重置…', 'connecting'); return; }
    newGame(vsAI);
  }

  /* ---------- UI ---------- */
  function syncUI() {
    if (!state) return;
    var cur = state.turn;
    el.turnLabel.textContent = state.winner >= 0
      ? '对局结束'
      : (onlineMode
          ? (state.turn === myColor() ? '轮到你落子' : '对手落子中')
          : (state.turn === 1 ? '黑棋落子' : '白棋落子'));
    el.turnLabel.className = 'turn-val p' + (state.winner >= 0 ? (state.winner === 0 ? 0 : state.winner) : cur);
    el.btnNew.disabled = reqPending;
  }

  /* ---------- 指针事件 ---------- */
  function canvasPos(e) {
    var rect = boardCanvas.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  boardCanvas.addEventListener('mousemove', function (e) {
    hover = null;
    if (!state || !myTurn()) { boardCanvas.style.cursor = 'default'; return; }
    var p = canvasPos(e);
    var cell = R.hitCell(p.x, p.y);
    if (!cell) { boardCanvas.style.cursor = 'default'; return; }
    if (state.board[cell.r][cell.c] !== 0) { boardCanvas.style.cursor = 'not-allowed'; return; }
    hover = cell;
    boardCanvas.style.cursor = 'pointer';
  });
  boardCanvas.addEventListener('mouseleave', function () { hover = null; });

  boardCanvas.addEventListener('click', function (e) {
    if (!state || !myTurn()) return;
    var p = canvasPos(e);
    var cell = R.hitCell(p.x, p.y);
    if (!cell) return;
    if (state.board[cell.r][cell.c] !== 0) return;
    placeAt(cell.r, cell.c);
  });

  /* ---------- 按钮 ---------- */
  el.btnNew.addEventListener('click', requestNew);
  if (el.btnReqOk) el.btnReqOk.addEventListener('click', function () { if (incomingKind === 'new') respondNew(true); });
  if (el.btnReqNo) el.btnReqNo.addEventListener('click', function () { if (incomingKind === 'new') respondNew(false); });

  document.addEventListener('keydown', function (e) {
    if (!state) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 'n') el.btnNew.click();
  });

  /* ---------- 循环 ---------- */
  function loop() {
    if (state) {
      R.draw(state, { interactive: myTurn(), hover: hover, previewColor: (mode === 'local' ? state.turn : myColor()) });
    }
    requestAnimationFrame(loop);
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { R.resize(); }, 80);
  });
  R.resize();
  loop();

  /* ---------- 开局引导 ---------- */
  function boot() {
    var params = new URLSearchParams(location.search);
    var m = params.get('mode');
    if (m === 'ai') { mode = 'ai'; onlineMode = false; humanColor = 1; aiSide = 2; newGame(true); }
    else if (m === 'local') { mode = 'local'; onlineMode = false; humanColor = 1; newGame(false); }
    else if (m === 'online') {
      var room = (params.get('room') || '').trim().toUpperCase();
      var role = params.get('role') || 'guest';
      if (!room) {
        if (el.onlineStatus) { el.onlineStatus.hidden = false; showOnlineStatus('缺少房间码，请从「互联网对战」页进入'); }
        return;
      }
      mode = 'online'; onlineMode = true; myPlayer = role === 'host' ? 0 : 1; humanColor = role === 'host' ? 1 : 2;
      roomStarted = false; currentRoom = room;
      state = G.createState(); welcomed = false; reqPending = false; resetSent = false;
      if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + room; el.roomCodeTag.hidden = false; }
      if (el.onlineStatus) el.onlineStatus.hidden = false;
      syncUI();
      online = new window.GomokuOnline();
      lobby = new window.GameLobby({
        onReady: function () { if (online) online.sendReady(); },
        onStart: function () { if (online) online.sendStart(); },
        onLeave: function () { if (online) online.sendLeave(); location.href = 'gomoku-online.html'; }
      });
      lobby.show(room);
      lobby.setStatus('连接中…', 'connecting');
      bindOnline(online);
      online.connect(role === 'host' ? 0 : 1);
    } else {
      location.href = 'gomoku.html';
    }
  }

  boot();

  window.GomokuGame = {
    get state() { return state; },
    get mode() { return mode; },
    get onlineMode() { return onlineMode; },
    get myPlayer() { return myPlayer; },
    engine: G
  };
})();
