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
  var timer = null;          // GameTimer 状态（local/ai 客户端权威；online 用服务端下达 timing）
  var timerCfg = { mode: 'off', baseMs: 0, byoCount: 0, byoMs: 0 };
  var undoPending = false;   // 联机：悔棋请求进行中（锁输入）
  var atStart = false;       // 本地/ai：是否已落第一手（落子后锁定计时选择）
  var coinLock = false;      // 抛硬币动画期间锁输入
  var coinShown = false;     // 本局是否已播放过抛硬币（联机重开时复位）

  var el = {};
  ['turnLabel', 'phaseLabel', 'boardTitle', 'btnNew', 'btnUndo', 'onlineStatus', 'roomCodeTag',
   'reqModal', 'reqText', 'reqSub', 'btnReqOk', 'btnReqNo', 'banner',
   'timerCard', 'timerTag', 'clockRow', 'clockName0', 'clockName1',
   'clockTime0', 'clockTime1', 'clockByo0', 'clockByo1',
   'coinModal', 'coin', 'coinTitle', 'coinResult', 'coinSub'].forEach(function (id) {
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
    if (!onlineMode) {
      var bp = Math.random() < 0.5 ? 0 : 1;      // 抛硬币：0=玩家一(人类)执黑, 1=玩家二(AI)执黑
      if (ai) { humanColor = bp === 0 ? 1 : 2; aiSide = 3 - humanColor; }
      syncUI();
      playCoin(bp, { ai: ai });
    }
    syncUI();
    initTimer();
  }

  // 抛硬币决定先手（谁执黑）：first = 执黑方玩家序号 0/1
  function playCoin(first, opts) {
    opts = opts || {};
    coinLock = true; coinShown = true;
    if (!el.coinModal) { coinLock = false; return; }
    el.coinModal.hidden = false;
    el.coin.classList.remove('flip', 'settled');
    el.coinTitle.textContent = '随机先手';
    el.coinResult.textContent = '';
    el.coinSub.textContent = '';
    void el.coin.offsetWidth;                    // 强制重排重启动画
    el.coin.classList.add('flip');
    setTimeout(function () {
      var firstLabel, sub;
      if (opts.ai) {
        firstLabel = first === 0 ? '⚫ 你（黑）先手' : '⚪ 电脑（白）先手';
        sub = first === 0 ? '你执黑，开始！' : '电脑执白，稍候…';
      } else if (opts.mode === 'online') {
        firstLabel = (first === myPlayer) ? '⚫ 你（黑）先手' : '⚪ 对手（白）先手';
        sub = (first === myPlayer) ? '你执黑，开始！' : '对手执黑，你执白';
      } else {
        firstLabel = first === 0 ? '⚫ 玩家一（黑）先手' : '⚪ 玩家二（白）先手';
        sub = first === 0 ? '玩家一执黑先行' : '玩家二执黑先行';
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

  function initTimer() {
    if (!onlineMode && timerCfg && timerCfg.mode !== 'off') {
      timer = window.GameTimer.create(timerCfg, 0);   // 黑（玩家0）先手
      window.GameTimer.start(timer, Date.now());
    } else if (onlineMode) {
      timer = (state && state.timing) ? state.timing : null;
    } else {
      timer = null;
    }
    renderTimerUI();
  }

  function renderTimerUI() {
    if (!el.timerCard) return;
    var cfgOn = !!(timerCfg && timerCfg.mode !== 'off');
    if (el.clockRow) el.clockRow.hidden = !(timer && timer.mode !== 'off');
    var names = ['黑', '白'];
    if (el.timerTag) {
      var t = timerCfg || null;
      if (!t || t.mode === 'off') el.timerTag.textContent = '不限时';
      else if (t.mode === 'blitz') el.timerTag.textContent = '包干 ' + Math.round(t.baseMs / 60000) + ' 分钟';
      else el.timerTag.textContent = '读秒 ' + Math.round(t.baseMs / 60000) + ' 分 + ' + t.byoCount + '×' + Math.round(t.byoMs / 1000) + ' 秒';
    }
    if (el.clockName0) el.clockName0.textContent = onlineMode ? (myPlayer === 0 ? '你' : '对手') : names[0];
    if (el.clockName1) el.clockName1.textContent = onlineMode ? (myPlayer === 1 ? '你' : '对手') : names[1];
  }

  function renderClock() {
    if (!timer || timer.mode === 'off') return;
    var snap = window.GameTimer.snapshot(timer, Date.now());
    var defs = [el.clockTime0, el.clockByo0, el.clockTime1, el.clockByo1];
    for (var i = 0; i < 2; i++) {
      var tEl = el['clockTime' + i], bEl = el['clockByo' + i], cEl = el['clock' + i];
      if (!tEl) continue;
      tEl.textContent = window.GameTimer.fmt(snap['t' + i].remaining);
      if (timer.mode === 'byo') {
        bEl.textContent = snap['t' + i].byo > 0 ? '读秒 ×' + snap['t' + i].byo : (snap['t' + i].byo === 0 ? '读秒最后' : '');
      } else if (bEl) bEl.textContent = '';
      if (cEl) {
        cEl.classList.toggle('run', !!snap['t' + i].running);
        cEl.classList.toggle('out', snap.winner === i);
      }
    }
    if (snap.winner >= 0) {
      timer.winner = snap.winner;
      onTimeOut(snap.winner);
    }
  }

  function onTimeOut(loser) {
    if (!state || state.winner >= 0 || timer.winner < 0) return;
    var winnerColor = loser === 0 ? 2 : 1;   // 超时方判负，对方获胜（棋子色）
    state.winner = winnerColor;
    if (timer) timer.active = false;
    syncUI();
    if (el.onlineStatus) showOnlineStatus('对方超时，' + (winnerColor === 1 ? '黑' : '白') + '获胜', 'connected');
    onWin(winnerColor);
  }

  function placeAt(r, c) {
    if (!myTurn() || undoPending) return;
    if (onlineMode) { online.sendMove(r, c); return; }
    // 本地热座：用当前回合方颜色落子（不绑定人类身份）
    var color = (mode === 'local') ? state.turn : myColor();
    var beatTimer = timer;               // 结算用当前（黑=0/白=1）
    var res = G.place(state, color, r, c);
    if (!res) return;
    var moved = (color === 1) ? 0 : 1;
    if (timer && timer.mode !== 'off') {
      var over = window.GameTimer.onMove(timer, moved, Date.now());
      if (over >= 0) { timer.winner = over; onTimeOut(over); }
    }
    if (!atStart) { atStart = true; renderTimerUI(); }
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
      var movedAI = (aiSide === 1) ? 0 : 1;
      if (timer && timer.mode !== 'off') {
        var tOver = window.GameTimer.onMove(timer, movedAI, Date.now());
        if (tOver >= 0) { timer.winner = tOver; onTimeOut(tOver); }
      }
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
      if (v.timing) { timer = v.timing; renderTimerUI(); }
      if (reqKind === 'undo') { reqKind = null; reqPending = false; undoPending = false; }
      if (v.history && v.history.length === 0) {
        coinShown = false;                       // 新一局（含重开）复位，准备播硬币
        if (typeof v.blackPlayer === 'number') playCoin(v.blackPlayer, { mode: 'online' });
      }
      if (state.winner >= 0) onWin(state.winner);
      syncUI();
    });
    o.on('players', function (ps) {
      var opp = !!(ps[1 - myPlayer]);
      if (!roomStarted) {
        if (lobby) lobby.setStatus(opp ? '双方已就位，准备开始' : '等待对手加入…', opp ? 'connected' : 'connecting');
        return;
      }
      // 对局中：对手离线/退出 → 明确提示（修复「对手退出无感知」）
      if (!opp) showOnlineStatus('对手已退出/断开连接，对局暂停', 'disconnected');
      else showOnlineStatus('对局进行中', 'connected');
    });
    o.on('req_undo', function () {
      reqPending = true; incomingKind = 'undo';
      if (el.reqText) el.reqText.textContent = '对方请求悔棋';
      if (el.reqSub) el.reqSub.textContent = '同意后回退上一步';
      if (el.reqModal) el.reqModal.hidden = false;
      syncUI();
    });
    o.on('res_undo', function (ok) {
      reqPending = false; undoPending = false; reqKind = null;
      showOnlineStatus(ok ? '对方已同意悔棋' : '对方拒绝了悔棋', ok ? 'connected' : 'disconnected');
      syncUI();
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

  function requestUndo() {
    if (!state || state.winner >= 0 || undoPending || reqPending) return;
    if (state.history.length === 0) return;
    if (onlineMode) {
      undoPending = true; reqKind = 'undo';
      online.sendRelay('req_undo');
      showOnlineStatus('已请求悔棋，等待对方确认…', 'connecting');
    } else {
      doUndoLocal();
    }
    syncUI();
  }
  function doUndoLocal() {
    if (!state || state.history.length === 0) return;
    G.undo(state);
    hideBanner();
    syncUI();
  }
  function respondUndo(ok) {
    incomingKind = null;
    if (el.reqModal) el.reqModal.hidden = true;
    if (onlineMode) {
      undoPending = false; reqPending = false; reqKind = null;
      online.sendRelay('res_undo', ok);
      showOnlineStatus(ok ? '已同意悔棋' : '已拒绝悔棋', ok ? 'connected' : 'disconnected');
    }
    syncUI();
  }

  /* ---------- UI ---------- */
  function syncUI() {
    if (!state) return;
    var cur = state.turn;
    el.turnLabel.textContent = state.winner >= 0
      ? '对局结束'
      : (onlineMode
          ? (state.turn === myColor() ? '轮到你落子' : '对手落子中')
          : (vsAI
              ? (state.turn === humanColor ? '轮到你落子' : '电脑思考中')
              : (state.turn === 1 ? '黑棋落子' : '白棋落子')));
    el.turnLabel.className = 'turn-val p' + (state.winner >= 0 ? (state.winner === 0 ? 0 : state.winner) : cur);
    el.btnNew.disabled = reqPending;
    if (el.btnUndo) el.btnUndo.disabled = undoPending || reqPending || !state || state.winner >= 0 || state.history.length === 0;
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
  if (el.btnUndo) el.btnUndo.addEventListener('click', requestUndo);
  if (el.btnReqOk) el.btnReqOk.addEventListener('click', function () {
    if (incomingKind === 'new') respondNew(true);
    else if (incomingKind === 'undo') respondUndo(true);
  });
  if (el.btnReqNo) el.btnReqNo.addEventListener('click', function () {
    if (incomingKind === 'new') respondNew(false);
    else if (incomingKind === 'undo') respondUndo(false);
  });

  document.addEventListener('keydown', function (e) {
    if (!state) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 'n') el.btnNew.click();
    if (e.key.toLowerCase() === 'u') requestUndo();
  });

  /* ---------- 循环 ---------- */
  function loop() {
    if (state) {
      R.draw(state, { interactive: myTurn(), hover: hover, previewColor: (mode === 'local' ? state.turn : myColor()) });
      renderClock();
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
    timerCfg = { mode: 'blitz', baseMs: 10 * 60000, byoCount: 3, byoMs: 30000 };  // 计时必须开启，规则固定不可改
    renderTimerUI();
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
      online.code = room;               // 必须设置房间码，否则 WS 连到 /api/room/null/ws 永远收不到 welcome
      lobby = new window.GameLobby({
        onReady: function () { if (online) online.sendReady(); },
        onStart: function () { if (online) online.sendStart(timerCfg && timerCfg.mode !== 'off' ? timerCfg : null); },
        onLeave: function () { if (online) online.sendLeave(); location.href = 'gomoku-online.html'; }
      });
      lobby.show(room);
      lobby.setStatus('连接中…', 'connecting');
      if (el.timerPick) el.timerPick.hidden = (role !== 'host');   // 联机仅房主可选计时
      renderTimerUI();
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
