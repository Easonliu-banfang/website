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

  var el = {};
  ['turnLabel', 'w1', 'w2', 'banner', 'btnMove', 'btnWall', 'btnUndo',
   'btnNew', 'stepCount', 'p2name', 'onlineStatus', 'roomCodeTag'].forEach(function (id) {
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
    el.btnWall.disabled = !placing && state.players[state.turn].walls <= 0;
    el.btnUndo.disabled = onlineMode || state.history.length === 0;
    el.btnNew.disabled = onlineMode;
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
    if (onlineMode) return connOk && state.turn === myPlayer;
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
  el.btnNew.addEventListener('click', function () { newGame(vsAI); });

  el.btnUndo.addEventListener('click', function () {
    if (aiThinking || !state.history.length) return;
    Q.undo(state);
    if (vsAI && state.history.length) Q.undo(state);
    el.banner.classList.remove('show');
    placing = false;
    R.anim = null;
    R.hover = null;
    aiThinking = false;
    syncUI();
    updateHints();
  });

  /* ---------- 联机模式（互联网对战） ---------- */

  function showOnlineStatus(msg, cls) {
    if (!el.onlineStatus) return;
    el.onlineStatus.textContent = msg;
    el.onlineStatus.className = 'status' + (cls ? ' status--' + cls : '');
  }

  function applyRemote(s) {
    state = s;
    R.hover = null;
    placing = false;
    syncUI();
    updateHints();
    if (state.winner >= 0) {
      el.banner.textContent = (state.winner === myPlayer ? '你赢了' : '对手获胜') + ' 抵达对岸';
      el.banner.classList.add('show');
    }
  }

  function bindOnlineEvents(o) {
    o.on('welcome', function (p) {
      var first = (myPlayer < 0);
      myPlayer = p;
      connOk = true;
      if (first) {
        showOnlineStatus(p === 0 ? '你是红方（先手），等待对手加入…' : '你是紫方（后手），等待对手加入…', 'connected');
      } else {
        showOnlineStatus('已重新连接，继续对战', 'connected');
      }
      syncUI();
      updateHints();
    });
    o.on('state', function (s) { applyRemote(s); });
    o.on('players', function (ps) {
      oppConnected = ps[1 - myPlayer];
      if (myPlayer >= 0) {
        showOnlineStatus(oppConnected ? '对手已连接，开战！' : '等待对手加入…（把房间码发给朋友）', 'connected');
      }
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
    myPlayer = -1;
    connOk = false;
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
    if (!started || onlineMode) return;
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
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
      // 无参数：回退到模式选择页
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
    renderer: R,
    engine: Q,
    newGame: newGame
  };
})();
