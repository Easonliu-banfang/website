/* 交互层：读取 URL 参数开局（local / ai / online），处理鼠标操作、AI 对手、渲染循环、联机同步 */
(function () {
  'use strict';

  var Q = window.Quoridor;
  var canvas = document.getElementById('board');
  var R = new window.QRender(canvas);

  var state = null;
  var vsAI = true;
  var aiSide = 1;
  var placing = false;
  var aiThinking = false;
  var started = false;

  // 联机模式
  var online = null;
  var onlineMode = false;
  var myPlayer = -1;
  var oppConnected = false;
  var connOk = false;   // 联机通道是否就绪，断线重连期间为 false，锁输入
  var welcomed = false;

  // 悔棋 / 重开 的双向确认状态
  var reqPending = false;     // 本端是否正处于请求/响应待定中（锁输入）
  var reqKind = null;         // 'undo' | 'new' | null：本端发起的请求类型
  var incomingKind = null;    // 'undo' | 'new' | null：对方发来的请求类型
  var leftShown = false;      // 是否已弹出「对手离开」横幅

  var el = {};
  ['turnLabel', 'w1', 'w2', 'banner', 'btnMove', 'btnWall', 'btnUndo',
   'btnNew', 'stepCount', 'p2name', 'onlineStatus', 'roomCodeTag',
   'reqModal', 'reqText', 'reqSub', 'btnReqOk', 'btnReqNo'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  function isAITurn() { return vsAI && state && state.turn === aiSide; }

  /* ---------- 局面控制 ---------- */

  function newGame(ai) {
    vsAI = !!ai;
    state = Q.createState();
    placing = false;
    aiThinking = false;
    R.anim = null;
    R.hover = null;
    el.banner.classList.remove('show');
    el.p2name.textContent = vsAI ? '电脑' : '玩家二';
    syncUI();
    maybeAI();
  }

  function startLocal() { started = true; newGame(false); }
  function startAI()    { started = true; newGame(true); }

  function syncUI() {
    el.w1.textContent = state.players[0].walls;
    el.w2.textContent = state.players[1].walls;
    el.stepCount.textContent = Math.ceil(state.history.length / 2);

    if (state.winner >= 0) {
      el.turnLabel.textContent = onlineMode
        ? (state.winner === myPlayer ? '你赢了' : '对手获胜')
        : (state.winner === 0 ? '玩家一' : '玩家二') + ' 获胜';
    } else if (onlineMode) {
      el.turnLabel.textContent = (state.turn === myPlayer ? '你' : '对手') + ' 行动';
    } else if (aiThinking) {
      el.turnLabel.textContent = '电脑思考中';
    } else {
      el.turnLabel.textContent = (state.turn === 0 ? '玩家一' : (vsAI ? '电脑' : '玩家二')) + ' 行动';
    }
    el.turnLabel.className = 'turn-val p' + (state.winner >= 0 ? state.winner : state.turn);

    el.btnMove.classList.toggle('on', !placing);
    el.btnWall.classList.toggle('on', placing);
    var wallPlayer = (onlineMode && myPlayer >= 0) ? myPlayer : state.turn;
    el.btnWall.disabled = !placing && state.players[wallPlayer].walls <= 0;
    el.btnUndo.disabled = reqPending || state.history.length === 0;
    el.btnNew.disabled = reqPending;
  }

  function updateHints() {
    if (!state || state.winner >= 0 || aiThinking || isAITurn() || placing) R.hints = [];
    else R.hints = Q.legalMoves(state, state.turn);
  }

  function afterAction() {
    R.hover = null;
    placing = false;
    syncUI();
    updateHints();
    if (state.winner >= 0) {
      el.banner.textContent = onlineMode
        ? (state.winner === myPlayer ? '你赢了' : '对手获胜') + ' 抵达对岸'
        : (state.winner === 0 ? '玩家一' : (vsAI ? '电脑' : '玩家二')) + ' 抵达对岸';
      el.banner.classList.add('show');
      return;
    }
    maybeAI();
  }

  /* ---------- AI ---------- */

  function aiBlockCandidate(s, p) {
    var foe = 1 - p;
    var path = Q.shortestPath(s, foe);
    if (!path || !path.length) return null;
    var f = s.players[foe], n = path[0];
    var dr = n.r - f.r, dc = n.c - f.c;
    var cand = [];
    if (dr === -1)      { cand.push([f.r - 1, f.c, 'H'], [f.r - 1, f.c - 1, 'H']); }
    else if (dr === 1)  { cand.push([f.r, f.c, 'H'],     [f.r, f.c - 1, 'H']); }
    else if (dc === -1) { cand.push([f.r, f.c - 1, 'V'], [f.r - 1, f.c - 1, 'V']); }
    else if (dc === 1)  { cand.push([f.r, f.c, 'V'],     [f.r - 1, f.c, 'V']); }
    for (var i = 0; i < cand.length; i++) {
      if (Q.canPlaceWall(s, cand[i][0], cand[i][1], cand[i][2])) {
        return { r: cand[i][0], c: cand[i][1], dir: cand[i][2] };
      }
    }
    return null;
  }

  function aiTurn() {
    var p = state.turn;
    var mine = Q.shortestPath(state, p);
    if (!mine || !mine.length) return;
    var foes = Q.shortestPath(state, 1 - p);
    if (state.players[p].walls > 0 && foes && foes.length <= mine.length + 1) {
      var w = aiBlockCandidate(state, p);
      if (w) { Q.placeWall(state, p, w.r, w.c, w.dir); return; }
    }
    Q.move(state, p, mine[0].r, mine[0].c);
  }

  function maybeAI() {
    if (onlineMode) return;
    if (!vsAI || !state || state.winner >= 0 || state.turn !== aiSide) return;
    aiThinking = true;
    syncUI();
    updateHints();
    setTimeout(function () {
      if (!state || state.winner >= 0) return;
      aiTurn();
      aiThinking = false;
      syncUI();
      updateHints();
      if (state.winner >= 0) {
        el.banner.textContent = '电脑 抵达对岸';
        el.banner.classList.add('show');
      }
    }, 400);
  }

  /* ---------- 输入 ---------- */

  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function interactive() {
    if (!state || state.winner >= 0 || aiThinking) return false;
    if (onlineMode) return connOk && !reqPending && state.turn === myPlayer;
    return !isAITurn();
  }

  canvas.addEventListener('mousemove', function (e) {
    if (!interactive()) { R.hover = null; canvas.style.cursor = 'default'; return; }
    var p = pointerPos(e);
    if (placing) {
      var w = R.hitWall(p.x, p.y);
      if (w) {
        w.type = 'wall';
        w.valid = state.players[state.turn].walls > 0 && Q.canPlaceWall(state, w.r, w.c, w.dir);
        R.hover = w;
        canvas.style.cursor = w.valid ? 'pointer' : 'not-allowed';
      } else {
        R.hover = null;
        canvas.style.cursor = 'default';
      }
    } else {
      var cell = R.hitCell(p.x, p.y);
      var can = false;
      if (cell) {
        for (var i = 0; i < R.hints.length; i++) {
          if (R.hints[i].r === cell.r && R.hints[i].c === cell.c) { can = true; break; }
        }
      }
      R.hover = can ? { type: 'cell', r: cell.r, c: cell.c } : null;
      canvas.style.cursor = can ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('mouseleave', function () { R.hover = null; });

  canvas.addEventListener('click', function (e) {
    if (!interactive()) return;
    var p = pointerPos(e);
    var who = onlineMode ? myPlayer : state.turn;

    if (placing) {
      var w = R.hitWall(p.x, p.y);
      if (!w || !Q.canPlaceWall(state, who, w.r, w.c, w.dir)) return;
      if (onlineMode) {
        Q.placeWall(state, who, w.r, w.c, w.dir);
        afterAction();
        online.sendWall(w.r, w.c, w.dir);
      } else if (Q.placeWall(state, who, w.r, w.c, w.dir)) {
        afterAction();
      }
      return;
    }

    var cell = R.hitCell(p.x, p.y);
    if (!cell) return;
    var legal = Q.legalMoves(state, who);
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].r === cell.r && legal[i].c === cell.c) {
        var from = { r: state.players[who].r, c: state.players[who].c };
        Q.move(state, who, cell.r, cell.c);
        R.startAnim(who, from, { r: cell.r, c: cell.c });
        if (onlineMode) { afterAction(); online.sendMove(cell.r, cell.c); }
        else afterAction();
        return;
      }
    }
  });

  /* ---------- 按钮 ---------- */

  function setPlacing(v) {
    if (!interactive()) return;
    if (v && state.players[state.turn].walls <= 0) return;
    placing = v;
    R.hover = null;
    syncUI();
    updateHints();
  }

  el.btnMove.addEventListener('click', function () { setPlacing(false); });
  el.btnWall.addEventListener('click', function () { setPlacing(!placing); });

  el.btnUndo.addEventListener('click', function () {
    if (onlineMode) { requestUndo(); return; }
    if (aiThinking || !state.history.length) return;
    Q.undo(state);
    if (vsAI && state.history.length) Q.undo(state);
    el.banner.classList.remove('show');
    placing = false; R.anim = null; R.hover = null; aiThinking = false;
    syncUI(); updateHints();
  });

  el.btnNew.addEventListener('click', function () {
    if (onlineMode) { requestNew(); return; }
    newGame(vsAI);
  });

  // 悔棋核心：撤回一步（联机下双方各自执行一次，保证一致）
  function doUndoCore() {
    Q.undo(state);
    el.banner.classList.remove('show');
    placing = false; R.anim = null; R.hover = null; aiThinking = false;
    syncUI(); updateHints();
  }

  /* ---------- 联机：悔棋 / 重开 的双向确认 ---------- */

  function showReqModal(text, sub) {
    if (!el.reqModal) return;
    el.reqText.textContent = text;
    el.reqSub.textContent = sub || '';
    el.reqModal.hidden = false;
  }
  function hideReqModal() { if (el.reqModal) el.reqModal.hidden = true; }

  function requestUndo() {
    if (reqPending || !state || state.history.length === 0 || state.winner >= 0) return;
    reqPending = true; reqKind = 'undo'; incomingKind = null;
    online.sendRelay('req_undo');
    showOnlineStatus('已发送悔棋请求，等待对方确认…', 'connecting');
    syncUI();
  }
  function respondUndo(ok) {
    incomingKind = null; hideReqModal();
    online.sendRelay('res_undo', ok);
    reqPending = false;
    if (ok) { doUndoCore(); showOnlineStatus('已同意悔棋', 'connected'); }
    else { showOnlineStatus('已拒绝对方悔棋', 'disconnected'); }
    syncUI();
  }

  function requestNew() {
    if (reqPending || !state) return;
    reqPending = true; reqKind = 'new'; incomingKind = null;
    online.sendRelay('req_new');
    showOnlineStatus('已发送重开请求，等待对方确认…', 'connecting');
    syncUI();
  }
  function respondNew(ok) {
    incomingKind = null; hideReqModal();
    online.sendRelay('res_new', ok);
    reqPending = false;
    if (ok) { showOnlineStatus('已同意重开，等待重置…', 'connecting'); }
    else { showOnlineStatus('已拒绝对方重开', 'disconnected'); }
    syncUI();
  }

  if (el.btnReqOk) el.btnReqOk.addEventListener('click', function () {
    if (incomingKind === 'undo') respondUndo(true);
    else if (incomingKind === 'new') respondNew(true);
  });
  if (el.btnReqNo) el.btnReqNo.addEventListener('click', function () {
    if (incomingKind === 'undo') respondUndo(false);
    else if (incomingKind === 'new') respondNew(false);
  });

  /* ---------- 联机模式（互联网对战） ---------- */

  function showOnlineStatus(msg, cls) {
    if (!el.onlineStatus) return;
    el.onlineStatus.textContent = msg;
    el.onlineStatus.className = 'status' + (cls ? ' status--' + cls : '');
  }

  function opponentLeft() {
    reqPending = false; reqKind = null; incomingKind = null;
    hideReqModal();
    leftShown = true;
    showOnlineStatus('对手已离开游戏，等待其重连…', 'reconnecting');
    el.banner.textContent = '对手已离开游戏';
    el.banner.classList.add('show');
  }
  function opponentPresent() {
    if (leftShown) { leftShown = false; el.banner.classList.remove('show'); }
  }

  function applyRemote(s) {
    state = s;
    R.hover = null;
    placing = false;
    syncUI();
    updateHints();
    R.draw(state);   // 立即重绘：对方放墙/走子后无需等下一帧即可看到
    if (state.winner >= 0) {
      el.banner.textContent = (state.winner === myPlayer ? '你赢了' : '对手获胜') + ' 抵达对岸';
      el.banner.classList.add('show');
    }
  }

  function bindOnlineEvents(o) {
    o.on('welcome', function (p) {
      var first = !welcomed;
      welcomed = true;
      myPlayer = p;
      R.flip = (p === 1);   // 后手(紫方)翻转棋盘，看到自己在底部、对手在顶部
      connOk = true;
      if (first) {
        showOnlineStatus(p === 0 ? '你是红方（先手），等待对手加入…' : '成功进入房间（你是紫方·后手）', 'connected');
      } else {
        showOnlineStatus('已重新连接，继续对战', 'connected');
      }
      syncUI();
      updateHints();
    });
    o.on('state', function (s) { applyRemote(s); });
    o.on('players', function (ps) {
      var now = ps[1 - myPlayer];
      if (myPlayer < 0) { oppConnected = now; return; }
      if (now && !oppConnected) {
        opponentPresent();
        showOnlineStatus(myPlayer === 0 ? '对方已进入房间，开始游戏' : '双方已就位，开始游戏', 'connected');
      } else if (!now && oppConnected) {
        opponentLeft();
      } else if (!now) {
        showOnlineStatus(myPlayer === 0 ? '等待对手加入…（把房间码发给朋友）' : '等待对方创建房间…', 'connecting');
      }
      oppConnected = now;
    });
    o.on('req_undo', function () {
      if (!state || state.winner >= 0 || state.history.length === 0) { online.sendRelay('res_undo', false); return; }
      reqPending = true; incomingKind = 'undo';
      showReqModal('对方请求悔棋', '同意后撤回上一步');
      syncUI();
    });
    o.on('res_undo', function (ok) {
      reqPending = false;
      if (ok) { doUndoCore(); showOnlineStatus('悔棋成功', 'connected'); }
      else { showOnlineStatus('对方拒绝了悔棋', 'disconnected'); }
      syncUI();
    });
    o.on('req_new', function () {
      if (!state) { online.sendRelay('res_new', false); return; }
      reqPending = true; incomingKind = 'new';
      showReqModal('对方请求重开一局', '同意后棋局将重置');
      syncUI();
    });
    o.on('res_new', function (ok) {
      reqPending = false;
      if (ok) {
        // 发起人收到同意 → 通知服务端重置权威棋局并广播
        online.sendReset();
        showOnlineStatus('已同意重开，重置中…', 'connecting');
      } else {
        showOnlineStatus('对方拒绝了重开', 'disconnected');
      }
      syncUI();
    });
    o.on('status', function (s) {
      if (s.state === 'connecting') { connOk = false; showOnlineStatus('连接中…', 'connecting'); }
      else if (s.state === 'connected') { connOk = true; if (myPlayer < 0) showOnlineStatus('已连接', 'connected'); }
      else if (s.state === 'reconnecting') { connOk = false; showOnlineStatus(s.detail || '连接中断，重连中…', 'reconnecting'); }
      else if (s.state === 'disconnected') { connOk = false; showOnlineStatus(s.detail || '连接已断开', 'disconnected'); }
    });
    o.on('error', function (msg) { showOnlineStatus('错误：' + msg, 'disconnected'); });
    o.on('close', function () { connOk = false; showOnlineStatus('连接已断开', 'disconnected'); });
  }

  function startOnline(room, role) {
    onlineMode = true;
    myPlayer = role === 'host' ? 0 : 1;   // 提示性，welcome 最终确认
    R.flip = (myPlayer === 1);
    connOk = false;
    welcomed = false;
    reqPending = false; reqKind = null; incomingKind = null; leftShown = false;
    state = Q.createState();
    el.p2name.textContent = '对手';
    started = true;
    if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + room; el.roomCodeTag.hidden = false; }
    if (el.onlineStatus) el.onlineStatus.hidden = false;
    syncUI();
    updateHints();

    online = new window.QuoridorOnline();
    online.code = room;
    bindOnlineEvents(online);
    online.connect(role === 'host' ? 0 : 1);
  }

  document.addEventListener('keydown', function (e) {
    if (!started) return;
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (onlineMode) {
      if (k === 'u') el.btnUndo.click();
      else if (k === 'n') el.btnNew.click();
      return;
    }
    if (k === 'w') setPlacing(!placing);
    else if (k === 'u') el.btnUndo.click();
    else if (k === 'n') newGame(vsAI);
  });

  /* ---------- 循环 ---------- */

  function loop() {
    if (state) R.draw(state);
    requestAnimationFrame(loop);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { R.resize(); }, 80);
  });

  R.resize();
  loop();

  /* ---------- 开局引导：根据 URL 参数进入对应模式 ---------- */

  function boot() {
    var params = new URLSearchParams(location.search);
    var mode = params.get('mode');
    if (mode === 'ai') {
      startAI();
    } else if (mode === 'local') {
      startLocal();
    } else if (mode === 'online') {
      var room = (params.get('room') || '').trim().toUpperCase();
      var role = params.get('role') || 'guest';
      if (!room) {
        if (el.onlineStatus) { el.onlineStatus.hidden = false; showOnlineStatus('缺少房间码，请从「互联网对战」页进入'); }
        return;
      }
      startOnline(room, role);
    } else {
      location.href = 'quoridor.html';
    }
  }

  boot();

  /* 调试 / 扩展出口 */
  window.QuoridorGame = {
    get state() { return state; },
    get vsAI() { return vsAI; },
    get myPlayer() { return myPlayer; },
    get onlineMode() { return onlineMode; },
    get reqPending() { return reqPending; },
    renderer: R,
    engine: Q,
    online: online,
    newGame: newGame
  };
})();
