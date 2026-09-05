/* 交互层：模式选择、鼠标操作、AI 对手、渲染循环、联机 */
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

  var el = {};
  ['startScreen', 'modeGrid', 'onlinePanel', 'backModes', 'btnChooseMode', 'gameScreen',
   'turnLabel', 'w1', 'w2', 'banner', 'btnMove', 'btnWall', 'btnUndo',
   'btnNew', 'stepCount', 'p2name',
   'btnCreate', 'btnJoin', 'joinRow', 'inputCode', 'btnJoinGo',
   'roomRow', 'roomCode', 'btnCopy', 'onlineStatus'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  function isAITurn() { return vsAI && state && state.turn === aiSide; }

  /* ---------- 界面切换 ---------- */

  function enterGameScreen() {
    el.startScreen.hidden = true;
    el.gameScreen.hidden = false;
    R.resize();
  }

  function backToModes() {
    started = false;
    onlineMode = false;
    if (online) { online.close(); online = null; }
    state = null;
    R.anim = null;
    R.hover = null;
    el.banner.classList.remove('show');
    el.gameScreen.hidden = true;
    el.startScreen.hidden = false;
    el.modeGrid.hidden = false;
    el.onlinePanel.hidden = true;
    el.joinRow.hidden = true;
    el.roomRow.hidden = true;
    el.onlineStatus.textContent = '未连接';
  }

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

  function startLocal() { started = true; newGame(false); enterGameScreen(); }
  function startAI()    { started = true; newGame(true);  enterGameScreen(); }

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
    if (onlineMode) return state.turn === myPlayer;
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

  /* ---------- 模式选择 ---------- */

  el.modeGrid.addEventListener('click', function (e) {
    var card = e.target.closest('.mode-card');
    if (!card) return;
    var mode = card.getAttribute('data-mode');
    if (mode === 'local') startLocal();
    else if (mode === 'ai') startAI();
    else if (mode === 'online') { el.modeGrid.hidden = true; el.onlinePanel.hidden = false; }
  });

  el.btnChooseMode.addEventListener('click', backToModes);
  el.backModes.addEventListener('click', function () {
    el.onlinePanel.hidden = true;
    el.modeGrid.hidden = false;
    if (online) { online.close(); online = null; }
    onlineMode = false;
    el.joinRow.hidden = true;
    el.roomRow.hidden = true;
    el.onlineStatus.textContent = '未连接';
  });

  /* ---------- 联机模式（互联网对战） ---------- */

  function showOnlineStatus(msg) { el.onlineStatus.textContent = msg; }

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

  function startOnline(preferred) {
    onlineMode = true;
    myPlayer = -1;
    state = Q.createState();
    el.p2name.textContent = '对手';
    started = true;
    enterGameScreen();
    syncUI();
    updateHints();
    online.connect(preferred);
  }

  function bindOnlineEvents(o) {
    o.on('welcome', function (p) {
      myPlayer = p;
      showOnlineStatus(p === 0 ? '你是红方（先手），等待对手加入…' : '你是紫方（后手），等待对手加入…');
      syncUI();
      updateHints();
    });
    o.on('state', function (s) { applyRemote(s); });
    o.on('players', function (ps) {
      oppConnected = ps[1 - myPlayer];
      if (myPlayer >= 0) {
        showOnlineStatus(oppConnected ? '对手已连接，开战！' : '等待对手加入…（把房间码发给朋友）');
      }
    });
    o.on('error', function (msg) { showOnlineStatus('错误：' + msg); });
    o.on('close', function () { showOnlineStatus('连接已断开'); });
  }

  function doCreate() {
    if (online) return;
    online = new window.QuoridorOnline();
    bindOnlineEvents(online);
    showOnlineStatus('创建房间中…');
    online.createRoom().then(function (code) {
      el.roomCode.textContent = code;
      el.roomRow.hidden = false;
      startOnline(0);
    }).catch(function (e) { showOnlineStatus('创建失败：' + e.message); online = null; });
  }

  function doJoin() {
    if (online) return;
    var code = (el.inputCode.value || '').trim().toUpperCase();
    if (code.length !== 6) { showOnlineStatus('请输入 6 位房间码'); return; }
    online = new window.QuoridorOnline();
    bindOnlineEvents(online);
    showOnlineStatus('加入房间中…');
    online.joinRoom(code).then(function () {
      startOnline(1);
    }).catch(function (e) { showOnlineStatus('加入失败：' + e.message); online = null; });
  }

  el.btnCreate.addEventListener('click', doCreate);
  el.btnJoin.addEventListener('click', function () { el.joinRow.hidden = false; el.inputCode.focus(); });
  el.btnJoinGo.addEventListener('click', doJoin);
  el.inputCode.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  el.btnCopy.addEventListener('click', function () {
    var code = el.roomCode.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(function () {});
    showOnlineStatus('房间码已复制：' + code);
  });

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

  /* 调试 / 扩展出口 */
  window.QuoridorGame = {
    get state() { return state; },
    get vsAI() { return vsAI; },
    get myPlayer() { return myPlayer; },
    get onlineMode() { return onlineMode; },
    renderer: R,
    engine: Q,
    newGame: newGame,
    backToModes: backToModes
  };
})();
