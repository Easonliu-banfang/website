/* 围棋交互层：落子 / 停一手 / 三模式（local / ai / online）/ 终局数子（自动死活 + 可手动微调）。URL 驱动开局。 */
(function () {
  'use strict';

  var G = window.Go;
  var boardCanvas = document.getElementById('board');
  var R = new window.GoRender(boardCanvas);

  var V = 'g2';

  var state = null;
  var mode = 'local';
  var vsAI = false;
  var aiSide = 2;          // AI 执白
  var humanColor = 1;      // 人类执黑
  var myPlayer = 0;
  var boardSize = 19;

  var online = null;
  var onlineMode = false;
  var connOk = false;
  var welcomed = false;
  var reqPending = false;
  var incomingKind = null;
  var resetSent = false;
  var roomStarted = false;
  var currentRoom = '';
  var lobby = null;

  var winTimer = null, aiTimer = null;
  var hover = null;
  var scoringMode = false;
  var timer = null;          // GameTimer 状态
  var timerCfg = { mode: 'off', baseMs: 0, byoCount: 0, byoMs: 0 };
  var undoPending = false;   // 联机：悔棋请求进行中
  var atStart = false;       // 本地/ai：是否已落第一手
  var deadSet = [];        // 当前判定为死子的坐标 [[r,c]...]

  var el = {};
  ['turnLabel', 'phaseLabel', 'boardTitle', 'btnPass', 'btnNew', 'btnUndo', 'btnScore', 'btnRescore',
   'onlineStatus', 'roomCodeTag', 'reqModal', 'reqText', 'reqSub', 'btnReqOk', 'btnReqNo',
   'banner', 'scorePanel', 'scoreText', 'sizeTag', 'sizeCard',
   'timerCard', 'timerTag', 'clockRow', 'clockName0', 'clockName1',
   'clockTime0', 'clockTime1', 'clockByo0', 'clockByo1', 'timerPick'].forEach(function (id) { el[id] = document.getElementById(id); });

  function myColor() { return onlineMode ? (myPlayer === 0 ? 1 : 2) : humanColor; }

  function myTurn() {
    if (!state || state.winner >= 0 || scoringMode) return false;
    if (onlineMode) return connOk && !reqPending && state.turn === myColor();
    if (mode === 'local') return true;
    return state.turn === humanColor;
  }

  function hideBanner() { el.banner.classList.remove('show', 'big'); if (winTimer) { clearTimeout(winTimer); winTimer = null; } }
  function showBanner(text, big, autoClose) {
    el.banner.textContent = text; el.banner.classList.toggle('big', !!big); el.banner.classList.add('show');
    if (winTimer) clearTimeout(winTimer);
    if (autoClose) winTimer = setTimeout(hideBanner, 3200); else winTimer = null;
  }

  function newGame(ai, size) {
    vsAI = !!ai;
    boardSize = size || boardSize || 19;
    state = G.createState(boardSize);
    scoringMode = false; deadSet = [];
    reqPending = false; incomingKind = null; resetSent = false; hover = null;
    hideBanner();
    if (el.scorePanel) el.scorePanel.hidden = true;
    if (el.btnScore) el.btnScore.hidden = true;
    if (el.btnRescore) el.btnRescore.hidden = true;
    el.phaseLabel.textContent = '对局进行中';
    syncUI();
    initTimer();
  }

  function initTimer() {
    if (!onlineMode && timerCfg && timerCfg.mode !== 'off') {
      timer = window.GameTimer.create(timerCfg, 0);
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
    if (el.clockRow) el.clockRow.hidden = !(timer && timer.mode !== 'off');
    if (el.timerPick) {
      if (onlineMode) el.timerPick.hidden = roomStarted || myPlayer !== 0;  // 联机：开局后隐藏；未开局仅房主(0)可选
      else el.timerPick.hidden = !!atStart;                                  // 本地：第一手后锁定
    }
    if (el.timerTag) {
      var t = timerCfg || null;
      if (!t || t.mode === 'off') el.timerTag.textContent = '不限时';
      else if (t.mode === 'blitz') el.timerTag.textContent = '包干 ' + Math.round(t.baseMs / 60000) + ' 分钟';
      else el.timerTag.textContent = '读秒 ' + Math.round(t.baseMs / 60000) + ' 分 + ' + t.byoCount + '×' + Math.round(t.byoMs / 1000) + ' 秒';
    }
    if (el.clockName0) el.clockName0.textContent = (onlineMode && myPlayer === 0) ? '你' : '黑';
    if (el.clockName1) el.clockName1.textContent = (onlineMode && myPlayer === 1) ? '你' : '白';
  }

  function renderClock() {
    if (!timer || timer.mode === 'off') return;
    var snap = window.GameTimer.snapshot(timer, Date.now());
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
    var winnerColor = loser === 0 ? 2 : 1;
    state.winner = winnerColor;
    if (timer) timer.active = false;
    syncUI();
    if (el.onlineStatus) showOnlineStatus('对方超时，' + (winnerColor === 1 ? '黑' : '白') + '获胜', 'connected');
    onWin(winnerColor);
  }

  function tickTimer(movedColor) {
    if (!timer || timer.mode === 'off' || state.winner >= 0 || scoringMode) return;
    if (timer && timer.active) {
      var over = window.GameTimer.onMove(timer, movedColor === 1 ? 0 : 1, Date.now());
      if (over >= 0) { timer.winner = over; onTimeOut(over); }
    } else if (timer) {
      window.GameTimer.start(timer, Date.now());
    }
  }

  function placeAt(r, c) {
    if (!myTurn() || undoPending) return;
    if (onlineMode) { online.sendMove(r, c); return; }
    // 本地热座：用当前回合方颜色落子（不绑定人类身份）
    var color = (mode === 'local') ? state.turn : myColor();
    if (!G.place(state, color, r, c)) return;
    if (!atStart) { atStart = true; renderTimerUI(); }
    tickTimer(color);
    afterMove();
    syncUI();
  }

  function doPass() {
    if (!myTurn() || undoPending) return;
    if (onlineMode) { online.sendPass(); return; }
    var color = (mode === 'local') ? state.turn : myColor();
    if (!G.pass(state, color)) return;
    if (!atStart) { atStart = true; renderTimerUI(); }
    tickTimer(color);
    afterMove();
    syncUI();
  }

  function afterMove() {
    hideBanner();
    syncUI();
    if (state.winner === -2) { enterScoring(); return; }
    maybeAI();
  }

  function maybeAI() {
    if (onlineMode || !vsAI || !state || state.winner >= 0 || scoringMode) return;
    if (state.turn !== aiSide) return;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(function () {
      if (!state || state.winner >= 0 || state.turn !== aiSide || scoringMode) return;
      var mv = window.GoAI.nextMove(state, aiSide);
      if (!mv) { G.pass(state, aiSide); }
      else { if (!G.place(state, aiSide, mv[0], mv[1])) G.pass(state, aiSide); }
      tickTimer(aiSide);          // AI 走子（含停一手）也结算时钟
      hideBanner(); syncUI();
      if (state.winner === -2) { enterScoring(); return; }
    }, 600);
  }

  function enterScoring() {
    scoringMode = true;
    deadSet = G.autoDead(state);
    if (el.btnScore) el.btnScore.hidden = false;
    if (el.btnRescore) el.btnRescore.hidden = false;
    renderScore();
    showBanner('双方停手，进入数子阶段：点选死子后可改判', false);
    syncUI();
  }

  function toggleDead(r, c) {
    if (!scoringMode) return;
    if (state.board[r][c] === 0) return;
    var idx = -1;
    for (var i = 0; i < deadSet.length; i++) if (deadSet[i][0] === r && deadSet[i][1] === c) { idx = i; break; }
    if (idx >= 0) deadSet.splice(idx, 1); else deadSet.push([r, c]);
    renderScore();
  }

  function renderScore() {
    if (!el.scorePanel) return;
    var res = G.score(state, deadSet);
    el.scorePanel.hidden = false;
    var black = res.score1, white = res.score2;
    var lead = (black >= white) ? ('黑 +' + (black - white).toFixed(1)) : ('白 +' + (white - black).toFixed(1));
    el.scoreText.innerHTML =
      '<div class="score-row"><span>黑（含贴目前）</span><b>' + black.toFixed(1) + '</b></div>' +
      '<div class="score-row"><span>白（含贴目 ' + res.komi + '）</span><b>' + white.toFixed(1) + '</b></div>' +
      '<div class="score-row total"><span>当前领先</span><b>' + lead + '</b></div>' +
      '<div class="score-note">死子 ' + deadSet.length + ' 枚（点棋盘可改判）。确认后不可更改。</div>';
    el._lastScore = res;
  }

  function confirmScore() {
    if (!scoringMode) return;
    var res = el._lastScore || G.score(state, deadSet);
    state.winner = res.winner;
    state.score = res;
    scoringMode = false;
    if (el.btnScore) el.btnScore.hidden = true;
    if (el.btnRescore) el.btnRescore.hidden = true;
    onWin(res.winner, res);
  }

  function onWin(winner, res) {
    res = res || state.score;
    var txt;
    if (onlineMode) txt = winner === myColor() ? '🎉 你赢了！' : '对手获胜';
    else if (vsAI) txt = winner === humanColor ? '🎉 恭喜你胜利了！' : '😶 电脑获胜，再来一局？';
    else {
      var name = winner === 1 ? '黑棋' : (winner === 2 ? '白棋' : '和棋');
      var sc = res ? ('（黑 ' + res.score1 + ' · 白 ' + res.score2 + '）') : '';
      txt = name + ' 获胜 ' + sc;
    }
    showBanner(txt, true, true);
    syncUI();
  }

  /* ---------- 联机事件 ---------- */
  function showOnlineStatus(msg, cls) {
    if (!el.onlineStatus) return;
    el.onlineStatus.textContent = msg;
    el.onlineStatus.className = 'status' + (cls ? ' status--' + cls : '');
  }
  function fromView(v) {
    return {
      size: v.size, board: v.board, turn: v.turn, ko: v.ko,
      captures: v.captures, passes: v.passes || 0, winner: v.winner == null ? -1 : v.winner,
      history: v.history || [], score: v.score || null
    };
  }
  function bindOnline(o) {
    o.on('welcome', function (p) {
      welcomed = true; myPlayer = p; connOk = true; humanColor = p === 0 ? 1 : 2;
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
      setTimeout(function () { location.href = 'go-online.html'; }, 1800);
    });
    o.on('state', function (v) {
      state = fromView(v); myPlayer = v.you; connOk = true; boardSize = state.size; roomStarted = true;
      if (lobby) lobby.hide();
      if (v.timing) { timer = v.timing; renderTimerUI(); }
      if (reqKind === 'undo') { reqKind = null; reqPending = false; undoPending = false; }
      if (state.winner === -2 && !scoringMode) enterScoring();
      else if (state.winner >= 0) onWin(state.winner, state.score);
      syncUI();
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
    o.on('req_new', function () {
      reqPending = true; incomingKind = 'new';
      if (el.reqText) el.reqText.textContent = '对方请求重开一局';
      if (el.reqSub) el.reqSub.textContent = '同意后棋局将重置（同棋盘尺寸）';
      if (el.reqModal) el.reqModal.hidden = false;
      syncUI();
    });
    o.on('res_new', function (ok) {
      reqPending = false;
      if (ok) { if (!resetSent) { resetSent = true; online.sendReset(); } showOnlineStatus('已同意重开，重置中…', 'connecting'); }
      else showOnlineStatus('对方拒绝了重开', 'disconnected');
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
    reqPending = true; incomingKind = 'new';
    if (onlineMode) { online.sendRelay('req_new'); showOnlineStatus('已发送重开请求，等待对方确认…', 'connecting'); }
    else { beginNew(); }
    syncUI();
  }
  function respondNew(ok) {
    incomingKind = null; if (el.reqModal) el.reqModal.hidden = true;
    if (onlineMode) { online.sendRelay('res_new', ok); reqPending = false;
      if (ok) showOnlineStatus('已同意重开，等待重置…', 'connecting'); else showOnlineStatus('已拒绝对方重开', 'disconnected'); }
    else { beginNew(); }
    syncUI();
  }
  function requestUndo() {
    if (!state || state.winner >= 0 || scoringMode || undoPending || reqPending) return;
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
    scoringMode = false; deadSet = [];
    if (el.scorePanel) el.scorePanel.hidden = true;
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

    function beginNew() {
    if (onlineMode) { showOnlineStatus('等待服务端重置…', 'connecting'); return; }
    newGame(vsAI, boardSize);
  }

  /* ---------- UI ---------- */
  function syncUI() {
    if (!state) return;
    if (scoringMode) {
      el.turnLabel.textContent = '数子阶段';
      el.turnLabel.className = 'turn-val p0';
      if (el.btnPass) el.btnPass.disabled = true;
      return;
    }
    if (state.winner >= 0) {
      el.turnLabel.textContent = '对局结束';
      el.turnLabel.className = 'turn-val p0';
      if (el.btnPass) el.btnPass.disabled = true;
      return;
    }
    el.turnLabel.textContent = state.turn === 1 ? '黑棋落子' : '白棋落子';
    el.turnLabel.className = 'turn-val p' + state.turn;
    if (el.btnPass) el.btnPass.disabled = !myTurn();
    if (el.btnNew) el.btnNew.disabled = reqPending;
    if (el.btnUndo) el.btnUndo.disabled = undoPending || reqPending || !state || state.history.length === 0;
    if (el.sizeTag) { el.sizeTag.textContent = state.size + ' 路'; el.sizeTag.hidden = false; }
  }

  /* ---------- 指针事件 ---------- */
  function canvasPos(e) {
    var rect = boardCanvas.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  boardCanvas.addEventListener('mousemove', function (e) {
    hover = null;
    if (!state || !myTurn()) { boardCanvas.style.cursor = scoringMode ? (state ? 'pointer' : 'default') : 'default'; return; }
    var p = canvasPos(e);
    var cell = R.hitCell(p.x, p.y);
    if (!cell) { boardCanvas.style.cursor = 'default'; return; }
    if (state.board[cell.r][cell.c] !== 0) { boardCanvas.style.cursor = 'not-allowed'; return; }
    hover = cell; boardCanvas.style.cursor = 'pointer';
  });
  boardCanvas.addEventListener('mouseleave', function () { hover = null; });

  boardCanvas.addEventListener('click', function (e) {
    if (!state) return;
    var p = canvasPos(e);
    var cell = R.hitCell(p.x, p.y);
    if (!cell) return;
    if (scoringMode) { toggleDead(cell.r, cell.c); return; }
    if (!myTurn()) return;
    if (state.board[cell.r][cell.c] !== 0) return;
    placeAt(cell.r, cell.c);
  });

  /* ---------- 按钮 ---------- */
  if (el.btnPass) el.btnPass.addEventListener('click', doPass);
  if (el.btnNew) el.btnNew.addEventListener('click', requestNew);
  if (el.btnUndo) el.btnUndo.addEventListener('click', requestUndo);
  if (el.btnScore) el.btnScore.addEventListener('click', confirmScore);
  if (el.btnRescore) el.btnRescore.addEventListener('click', function () { deadSet = G.autoDead(state); renderScore(); });
  if (el.btnReqOk) el.btnReqOk.addEventListener('click', function () {
    if (incomingKind === 'new') respondNew(true);
    else if (incomingKind === 'undo') respondUndo(true);
  });
  if (el.btnReqNo) el.btnReqNo.addEventListener('click', function () {
    if (incomingKind === 'new') respondNew(false);
    else if (incomingKind === 'undo') respondUndo(false);
  });
  if (el.timerPick) el.timerPick.addEventListener('click', function (e) {
    var b = e.target;
    if (!b || b.tagName !== 'BUTTON' || !b.dataset.tm) return;
    var tm = b.dataset.tm;
    if (tm === 'blitz') timerCfg = { mode: 'blitz', baseMs: 10 * 60000 };
    else if (tm === 'byo') timerCfg = { mode: 'byo', baseMs: 10 * 60000, byoCount: 3, byoMs: 30000 };
    else timerCfg = { mode: 'off' };
    Array.prototype.forEach.call(el.timerPick.querySelectorAll('.tpick'), function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    renderTimerUI();
  });

  // 本机对局尺寸切换（联机隐藏）
  if (el.sizeCard) {
    if (onlineMode) el.sizeCard.hidden = true;
    else {
      var sizeBtns = el.sizeCard.querySelectorAll('.size-btn');
      function markActive() {
        for (var i = 0; i < sizeBtns.length; i++) {
          var b = sizeBtns[i];
          b.classList.toggle('active', parseInt(b.getAttribute('data-size'), 10) === boardSize);
        }
      }
      markActive();
      for (var i = 0; i < sizeBtns.length; i++) {
        sizeBtns[i].addEventListener('click', function () {
          var sz = parseInt(this.getAttribute('data-size'), 10);
          var m = onlineMode ? 'online' : (vsAI ? 'ai' : 'local');
          location.href = 'go-play.html?mode=' + m + '&size=' + sz;
        });
      }
    }
  }

  document.addEventListener('keydown', function (e) {
    if (!state) return;
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (k === 'n') el.btnNew && el.btnNew.click();
    else if (k === 'p' && !scoringMode) el.btnPass && el.btnPass.click();
    else if (k === 'u') requestUndo();
  });

  /* ---------- 循环 ---------- */
  function loop() {
    if (state) {
      R.draw(state, { interactive: myTurn(), hover: hover, previewColor: (mode === 'local' ? state.turn : myColor()), deadSet: deadSet, scoring: scoringMode });
      renderClock();
    }
    requestAnimationFrame(loop);
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { R.resize(); }, 80); });
  R.resize(); loop();

  /* ---------- 开局引导 ---------- */
  function boot() {
    // 默认计时跟随页面选中项（go 默认读秒 10 分 + 3×30 秒）
    var def = document.querySelector('.tpick.on');
    if (def && def.dataset.tm === 'blitz') timerCfg = { mode: 'blitz', baseMs: 10 * 60000 };
    else if (def && def.dataset.tm === 'byo') timerCfg = { mode: 'byo', baseMs: 10 * 60000, byoCount: 3, byoMs: 30000 };
    renderTimerUI();
    var params = new URLSearchParams(location.search);
    var m = params.get('mode');
    var sz = parseInt(params.get('size'), 10);
    if ([9, 13, 19].indexOf(sz) >= 0) boardSize = sz;
    if (m === 'ai') { mode = 'ai'; onlineMode = false; humanColor = 1; aiSide = 2; newGame(true, boardSize); }
    else if (m === 'local') { mode = 'local'; onlineMode = false; humanColor = 1; newGame(false, boardSize); }
    else if (m === 'online') {
      var room = (params.get('room') || '').trim().toUpperCase();
      var role = params.get('role') || 'guest';
      if (!room) { if (el.onlineStatus) { el.onlineStatus.hidden = false; showOnlineStatus('缺少房间码，请从「互联网对战」页进入'); } return; }
      mode = 'online'; onlineMode = true; myPlayer = role === 'host' ? 0 : 1; humanColor = role === 'host' ? 1 : 2;
      roomStarted = false; currentRoom = room;
      state = G.createState(boardSize); welcomed = false; reqPending = false; resetSent = false; scoringMode = false;
      if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + room; el.roomCodeTag.hidden = false; }
      if (el.onlineStatus) el.onlineStatus.hidden = false;
      syncUI();
      online = new window.GoOnline(boardSize);
      online.code = room;               // 必须设置房间码，否则 WS 连到 /api/room/null/ws 永远收不到 welcome
      lobby = new window.GameLobby({
        onReady: function () { if (online) online.sendReady(); },
        onStart: function () { if (online) online.sendStart(timerCfg && timerCfg.mode !== 'off' ? timerCfg : null); },
        onLeave: function () { if (online) online.sendLeave(); location.href = 'go-online.html'; }
      });
      lobby.show(room);
      lobby.setStatus('连接中…', 'connecting');
      if (el.timerPick) el.timerPick.hidden = (role !== 'host');
      renderTimerUI();
      bindOnline(online);
      online.connect(role === 'host' ? 0 : 1);
    } else {
      location.href = 'go.html';
    }
  }

  boot();

  window.GoGame = {
    get state() { return state; },
    get mode() { return mode; },
    get onlineMode() { return onlineMode; },
    get scoring() { return scoringMode; },
    engine: G
  };
})();
