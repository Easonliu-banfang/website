/* 海战棋交互层：放船阶段 + 开火阶段；三模式（local / ai / online），URL 驱动开局。
 * 渲染：两块 Canvas（己方海洋 ocean + 追踪板 tracking），沿用 Quoridor 的「服务端权威、本地整体替换」思路。
 */
(function () {
  'use strict';

  var B = window.Battleship;
  var oceanCanvas = document.getElementById('ocean');
  var trackCanvas = document.getElementById('tracking');
  var oceanR = new window.BRender(oceanCanvas, 'ocean');
  var trackR = new window.BRender(trackCanvas, 'tracking');

  // 缓存破坏版本号（改前端务必同步 bump）
  var V = 'g2';

  var state = null;
  var mode = 'local';
  var phase = 'place';          // 'place' 放船 | 'fire' 开火
  var vsAI = false;
  var aiSide = 1;
  var myPlayer = 0;             // online: 服务端分配；local/ai: 人类=0
  var placeTurn = 0;            // local 放船阶段：当前轮到谁布阵
  var curShip = 0;              // 手动放船：当前要放的第几艘
  var horizontal = false;       // 当前朝向

  // 联机
  var online = null;
  var onlineMode = false;
  var connOk = false;
  var welcomed = false;
  var reqPending = false;
  var reqKind = null;
  var incomingKind = null;
  var wantNew = false;
  var resetSent = false;
  var placedLocal = false;      // 本人是否已上报布阵（联机锁定用）
  var roomStarted = false;
  var currentRoom = '';
  var lobby = null;

  var winTimer = null;
  var aiTimer = null;

  var el = {};
  ['turnLabel', 'phaseLabel', 'oceanTitle', 'trackTitle', 'fleetStatus', 'fleetStatus2',
   'btnRandom', 'btnRotate', 'btnConfirm', 'btnNew', 'placePanel', 'firePanel',
   'onlineStatus', 'roomCodeTag', 'passModal', 'passText', 'btnPass',
   'reqModal', 'reqText', 'reqSub', 'btnReqOk', 'btnReqNo', 'banner',
   'rotateHint'].forEach(function (id) { el[id] = document.getElementById(id); });

  /* ---------- 视角 ---------- */
  function viewPlayer() {
    if (onlineMode) return myPlayer;
    if (mode === 'local') return phase === 'place' ? placeTurn : state.turn;
    return 0;   // ai：人类始终看自己的
  }

  function myTurnToPlace() {
    if (phase !== 'place' || state.winner >= 0) return false;
    if (onlineMode) return !placedLocal && connOk;
    if (mode === 'local') return !el.passModal.hidden ? false : true; // pass 遮罩显示时不可操作
    return true; // ai：人类布阵
  }

  function myTurnToFire() {
    if (phase !== 'fire' || state.winner >= 0) return false;
    if (onlineMode) return connOk && !reqPending && state.turn === myPlayer;
    if (mode === 'local') return !el.passModal.hidden ? false : true;
    return state.turn === 0;   // ai：轮到人类
  }

  function interactive() {
    if (phase === 'place') return myTurnToPlace();
    return myTurnToFire();
  }

  /* ---------- 横幅 ---------- */
  function hideBanner() { if (winTimer) { clearTimeout(winTimer); winTimer = null; } }
  // 棋盘横幅已取消：一律走顶部通知栏。big=胜负(常驻，按文案判 win/lose)；普通提示 info
  function showBanner(text, big, autoClose) {
    var isWin = /胜利|获胜|你赢了|恭喜/.test(text) && !/失败/.test(text);
    window.Notify.show(text, big ? (isWin ? 'win' : 'lose') : 'info', big ? { sticky: true } : undefined);
    if (winTimer) clearTimeout(winTimer);
    winTimer = null;
  }

  /* ---------- 局面初始化 ---------- */
  function newGame(ai) {
    vsAI = !!ai;
    state = B.createState();
    phase = 'place';
    placeTurn = 0;
    curShip = 0;
    horizontal = false;
    placedLocal = false;
    reqPending = false; reqKind = null; incomingKind = null; wantNew = false; resetSent = false;
    el.passModal.hidden = true;
    hideBanner();
    if (vsAI) {
      aiSide = 1;
      B.randomPlacement(state, aiSide);   // 电脑自动布阵
      window.Notify.setTurn('布阵阶段 · 摆放你的舰队');
      syncUI();
      // 人类布阵（带 pass 遮罩防偷看？同设备仅一人，不需遮罩）
    } else if (mode === 'local') {
      window.Notify.setTurn('布阵阶段 · 玩家一先摆');
      showPass('玩家一 布阵中', '请把设备交给玩家一，布好舰队后点击「确认布阵」。其他人请勿偷看。', function () {
        el.passModal.hidden = true; syncUI();
      });
    } else {
      el.phaseLabel.textContent = '布阵阶段 · 摆放你的舰队';
      syncUI();
    }
    updatePlacePanel();
    syncUI();
  }

  /* ---------- 放船面板 ---------- */
  function updatePlacePanel() {
    var show = (phase === 'place');
    el.placePanel.hidden = !show;
    if (!show) return;
    var vp = viewPlayer();
    // 仅展示「当前玩家」尚未放好的船；放好的置灰
    var list = state.ships[vp];
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var done = s.cells.length === s.size;
      var active = (i === curShip) && !done && myTurnToPlace();
      html += '<div class="ship-row' + (active ? ' active' : '') + (done ? ' done' : '') + '">' +
        '<span class="ship-dot" style="background:' + shipColor(i) + '"></span>' +
        '<span class="ship-name">' + s.name + '</span>' +
        '<span class="ship-size">' + s.size + ' 格</span>' +
        '<span class="ship-state">' + (done ? '✓' : (active ? '摆放中' : '')) + '</span>' +
        '</div>';
    }
    el.fleetStatus.innerHTML = html;
    el.btnConfirm.disabled = !B.allPlaced(state, vp) || !myTurnToPlace();
    el.rotateHint.textContent = horizontal ? '当前：横向 ▭' : '当前：纵向 ▯';
  }

  function shipColor(i) {
    return ['#4ee8f7', '#a78bfa', '#fbbf24', '#34d399', '#f472b6'][i];
  }

  function randomPlace() {
    if (!myTurnToPlace()) return;
    var vp = viewPlayer();
    B.randomPlacement(state, vp);
    curShip = B.FLEET.length;   // 全部放好
    syncUI(); updatePlacePanel();
  }

  function rotate() { horizontal = !horizontal; updatePlacePanel(); }

  function confirmPlace() {
    if (!myTurnToPlace()) return;
    var vp = viewPlayer();
    if (!B.allPlaced(state, vp)) { showBanner('还有船没摆好', false); return; }
    state.placed[vp] = true;     // 标记本玩家已布阵，否则 fire() 会拒绝
    if (onlineMode) {
      placedLocal = true;
      online.sendPlace(B.layoutOf(state, vp));
      showBanner('已上报布阵，等待对手…', false);
      el.placePanel.hidden = true;
      window.Notify.setTurn('等待双方布阵…');
      syncUI();
      return;
    }
    if (mode === 'local') {
      if (placeTurn === 0) {
        // 交给玩家二
        showPass('玩家二 布阵中', '请把设备交给玩家二，布好舰队后点击「确认布阵」。玩家一请勿偷看。', function () {
          el.passModal.hidden = true;
          placeTurn = 1; curShip = 0; horizontal = false;
          window.Notify.setTurn('布阵阶段 · 玩家二摆放');
          syncUI(); updatePlacePanel();
        });
      } else {
        // 双方布阵完成 → 开火
        startFirePhase();
      }
      syncUI(); updatePlacePanel();
      return;
    }
    // ai：人类布完 → 开火
    startFirePhase();
  }

  function startFirePhase() {
    phase = 'fire';
    state.turn = Math.random() < 0.5 ? 0 : 1;   // 随机先手
    el.placePanel.hidden = true;
    window.Notify.setTurn('开火阶段');
    var first = state.turn === 0 ? (vsAI ? '玩家' : '玩家一') : (vsAI ? '电脑' : '玩家二');
    showBanner(first + ' 先手！', false);
    syncUI(); updateFleet();
    maybeAI();
  }

  /* ---------- 开火 ---------- */
  function fireAt(r, c) {
    if (!myTurnToFire()) return;
    var vp = viewPlayer();
    if (onlineMode) {
      online.sendFire(r, c);
      afterFire();
      return;
    }
    var res = B.fire(state, vp, r, c);
    if (!res) return;
    afterFire(res);
  }

  function afterFire(res) {
    hideBanner();
    if (mode === 'local' && !onlineMode) {
      // 热座：交给对手前先弹遮罩
      showPass('传给 ' + (state.turn === 0 ? '玩家一' : '玩家二'),
        '轮到 ' + (state.turn === 0 ? '玩家一' : '玩家二') + ' 开火，请把设备交给 TA。', function () {
          el.passModal.hidden = true; syncUI(); updateFleet();
        });
    }
    syncUI(); updateFleet();
    if (state.winner >= 0) {
      onWin(state.winner);
      return;
    }
    maybeAI();
  }

  function onWin(winner) {
    if (onlineMode) {
      showBanner(winner === myPlayer ? '🎉 你赢了！' : '对手获胜', true);
    } else if (vsAI) {
      showBanner(winner === 0 ? '🎉 恭喜你胜利了！' : '😶 电脑获胜，再来一局？', true, true);
    } else {
      showBanner((winner === 0 ? '玩家一' : '玩家二') + ' 获胜', true);
    }
  }

  /* ---------- AI ---------- */
  function maybeAI() {
    if (onlineMode || !vsAI || !state || state.winner >= 0) return;
    if (state.turn !== aiSide) return;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(function () {
      if (!state || state.winner >= 0 || state.turn !== aiSide) return;
      var mv = window.BattleshipAI.nextShot(state, aiSide);
      if (!mv) return;
      var res = B.fire(state, aiSide, mv.r, mv.c);
      if (!res) { maybeAI(); return; }
      hideBanner(); syncUI(); updateFleet();
      if (state.winner >= 0) { onWin(state.winner); return; }
      // 轮回到人类
      syncUI();
    }, 650);
  }

  /* ---------- 联机事件 ---------- */
  function showOnlineStatus(msg, cls) {
    // 全局通知栏：颜色按严重程度分级（info 青 / success 绿 / warn 橙 / error 红）
    var type = cls === 'connected' ? 'success'
      : cls === 'reconnecting' ? 'warn'
      : cls === 'disconnected' ? 'error'
      : 'info';
    if (type === 'success') window.Notify.clearSticky();   // 连接恢复：清除待回滚的断开/重连常驻通知
    window.Notify.show(msg, type, (type === 'warn' || type === 'error') ? { sticky: true } : undefined);
  }

  function fromView(v) {
    return {
      ocean: [v.ocean, v.ocean],
      fire: [v.tracking, v.tracking],
      turn: v.turn, winner: v.winner, placed: v.placed,
      ships: v.fleet.map(function (list) {
        return list.map(function (s) { return { idx: 0, name: s.name, size: s.size, cells: [], sunk: s.sunk }; });
      }),
      history: v.history || []
    };
  }

  function bindOnline(o) {
    o.on('welcome', function (p) {
      welcomed = true;
      myPlayer = p;
      connOk = true;
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
        if (d.started) { window.Notify.clear('🔔 房主提醒你准备'); lobby.hide(); }
        else { lobby.show(currentRoom); lobby.render(d); }
      }
    });
    o.on('started', function () { roomStarted = true; if (lobby) lobby.hide(); });
    o.on('dissolve', function () {
      roomStarted = false;
      if (online) online._intentionalClose = true;
      if (lobby) lobby.hide();
      showOnlineStatus('房间已解散（有玩家离开），即将返回大厅…', 'disconnected');
      setTimeout(function () { location.href = 'battleship-online.html'; }, 1800);
    });
    o.on('state', function (v) {
      state = fromView(v);
      myPlayer = v.you;
      connOk = true; roomStarted = true;
      if (lobby) lobby.hide();
      phase = (v.placed[0] && v.placed[1]) ? 'fire' : 'place';
      if (phase === 'fire') el.placePanel.hidden = true;
      if (state.winner >= 0) onWin(state.winner);
      syncUI(); updateFleet(); updatePlacePanel();
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
    o.on('notify', function () { window.Notify.show('🔔 房主提醒你准备', 'warn'); });
    o.on('req_new', function () {
      reqPending = true; incomingKind = 'new';
      if (el.reqText) el.reqText.textContent = '对方请求重开一局';
      if (el.reqSub) el.reqSub.textContent = '同意后棋局将重置并重新布阵';
      if (el.reqModal) el.reqModal.hidden = false;
      syncUI();
    });
    o.on('res_new', function (ok) {
      reqPending = false; wantNew = false;
      if (ok) {
        if (!resetSent) { resetSent = true; online.sendReset(); }
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
      if (ok) { showOnlineStatus('已同意重开，等待重置…', 'connecting'); } else showOnlineStatus('已拒绝对方重开', 'disconnected'); }
    else { beginNew(); }
    syncUI();
  }

  function beginNew() {
    if (onlineMode) { /* 等待服务端 reset 广播 */ showOnlineStatus('等待服务端重置…', 'connecting'); return; }
    newGame(vsAI);
  }

  /* ---------- 侧栏 UI ---------- */
  function syncUI() {
    if (!state) return;
    var vp = viewPlayer();
    if (onlineMode) {
      if (!roomStarted) return;   // 等待室阶段不提示回合（开局后才显示）
      window.Notify.setTurn(phase === 'place'
        ? (placedLocal ? '等待对手布阵…' : '布置你的舰队')
        : (state.turn === myPlayer ? '你开火' : '对手开火'));
    } else if (phase === 'place') {
      window.Notify.setTurn(mode === 'local'
        ? ('玩家' + (placeTurn + 1) + ' 布阵')
        : '布置你的舰队');
    } else {
      window.Notify.setTurn(state.turn === 0
        ? (vsAI ? '你开火' : '玩家一 开火')
        : (vsAI ? '电脑开火' : '玩家二 开火'));
    }
    el.btnNew.disabled = reqPending;
    el.firePanel.hidden = (phase !== 'fire');
    updatePlacePanel();
  }

  function updateFleet() {
    if (!state) return;
    var vp = viewPlayer();
    var opp = 1 - vp;
    function col(p, title) {
      var list = state.ships[p];
      var html = '<div class="fleet-col"><div class="fleet-title">' + title + '</div>';
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        html += '<div class="ship-row' + (s.sunk ? ' sunk' : '') + '">' +
          '<span class="ship-dot" style="background:' + shipColor(i) + '"></span>' +
          '<span class="ship-name">' + s.name + '</span>' +
          '<span class="ship-state">' + (s.sunk ? '💀 已沉' : '🟦 在航') + '</span>' +
          '</div>';
      }
      return html + '</div>';
    }
    // 联机：自己看自己的舰队 + 对手（仅知沉没），不看对手船形
    var meTitle = onlineMode ? '我方舰队' : '玩家' + (vp + 1) + ' 舰队';
    var opTitle = onlineMode ? '敌方舰队' : '玩家' + (opp + 1) + ' 舰队';
    el.fleetStatus2.innerHTML = col(vp, meTitle) + col(opp, opTitle);
  }

  /* ---------- 海战棋专属：本地放船交互 ---------- */
  function placeCurrentAt(r, c) {
    if (!myTurnToPlace()) return;
    var vp = viewPlayer();
    if (curShip >= B.FLEET.length) return;
    if (B.placeShip(state, vp, curShip, r, c, horizontal)) {
      // 自动跳到下一艘未放好的船
      while (curShip < B.FLEET.length && state.ships[vp][curShip].cells.length === state.ships[vp][curShip].size) curShip++;
      syncUI(); updatePlacePanel();
    }
  }

  /* ---------- 指针事件 ---------- */
  function canvasPos(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  oceanCanvas.addEventListener('mousemove', function (e) {
    oceanR.preview = null;
    if (phase !== 'place' || !myTurnToPlace()) { oceanCanvas.style.cursor = phase === 'fire' ? 'default' : 'default'; return; }
    var p = canvasPos(oceanCanvas, e);
    var cell = oceanR.hitCell(p.x, p.y);
    if (!cell) { return; }
    var vp = viewPlayer();
    if (curShip >= B.FLEET.length) { return; }
    var cells = B.canPlaceShip(state, vp, curShip, cell.r, cell.c, horizontal);
    var valid = !!cells;
    oceanR.preview = { cells: cells || [], valid: valid };
    oceanCanvas.style.cursor = valid ? 'pointer' : 'not-allowed';
  });
  oceanCanvas.addEventListener('mouseleave', function () { oceanR.preview = null; });

  oceanCanvas.addEventListener('click', function (e) {
    if (phase !== 'place' || !myTurnToPlace()) return;
    var p = canvasPos(oceanCanvas, e);
    var cell = oceanR.hitCell(p.x, p.y);
    if (!cell) return;
    placeCurrentAt(cell.r, cell.c);
  });

  trackCanvas.addEventListener('mousemove', function (e) {
    trackR.hover = null;
    if (phase !== 'fire' || !myTurnToFire()) { trackCanvas.style.cursor = 'default'; return; }
    var p = canvasPos(trackCanvas, e);
    var cell = trackR.hitCell(p.x, p.y);
    if (!cell) return;
    var vp = viewPlayer();
    if (state.fire[vp][cell.r][cell.c] !== 0) { trackCanvas.style.cursor = 'not-allowed'; return; }
    trackR.hover = cell;
    trackCanvas.style.cursor = 'crosshair';
  });
  trackCanvas.addEventListener('mouseleave', function () { trackR.hover = null; });

  trackCanvas.addEventListener('click', function (e) {
    if (phase !== 'fire' || !myTurnToFire()) return;
    var p = canvasPos(trackCanvas, e);
    var cell = trackR.hitCell(p.x, p.y);
    if (!cell) return;
    var vp = viewPlayer();
    if (state.fire[vp][cell.r][cell.c] !== 0) return;   // 该格已打过
    fireAt(cell.r, cell.c);
  });

  /* ---------- 按钮 ---------- */
  el.btnRandom.addEventListener('click', randomPlace);
  el.btnRotate.addEventListener('click', rotate);
  el.btnConfirm.addEventListener('click', confirmPlace);
  el.btnNew.addEventListener('click', requestNew);
  if (el.btnPass) el.btnPass.addEventListener('click', function () {
    el.passModal.hidden = true;
    if (el.btnPass._cb) { var cb = el.btnPass._cb; el.btnPass._cb = null; cb(); }
  });
  if (el.btnReqOk) el.btnReqOk.addEventListener('click', function () { if (incomingKind === 'new') respondNew(true); });
  if (el.btnReqNo) el.btnReqNo.addEventListener('click', function () { if (incomingKind === 'new') respondNew(false); });

  function showPass(title, sub, cb) {
    el.passModal.hidden = false;
    el.passText.innerHTML = '<b>' + title + '</b><br><span style="opacity:.8;font-size:13px">' + sub + '</span>';
    el.btnPass._cb = cb;
  }

  document.addEventListener('keydown', function (e) {
    if (!state) return;
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (k === 'r') rotate();
    else if (k === 'n') el.btnNew.click();
  });

  /* ---------- 循环 ---------- */
  function loop() {
    if (state) {
      var vp = viewPlayer();
      oceanR.draw(state, vp, {});
      trackR.draw(state, vp, { canFire: myTurnToFire() });
    }
    requestAnimationFrame(loop);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { oceanR.resize(); trackR.resize(); }, 80);
  });

  oceanR.resize(); trackR.resize();
  loop();

  /* ---------- 开局引导 ---------- */
  function boot() {
    var params = new URLSearchParams(location.search);
    var m = params.get('mode');
    if (m === 'ai') { mode = 'ai'; onlineMode = false; newGame(true); }
    else if (m === 'local') { mode = 'local'; onlineMode = false; newGame(false); }
    else if (m === 'online') {
      var room = (params.get('room') || '').trim().toUpperCase();
      var role = params.get('role') || 'guest';
      if (!room) {
        showOnlineStatus('缺少房间码，请从「互联网对战」页进入');
        return;
      }
      mode = 'online'; onlineMode = true; myPlayer = role === 'host' ? 0 : 1;
      roomStarted = false; currentRoom = room;
      state = B.createState(); phase = 'place'; placedLocal = false; welcomed = false;
      if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + room; el.roomCodeTag.hidden = false; }
      syncUI();
      online = new window.BattleshipOnline();
      online.code = room;               // 必须设置房间码，否则 WS 连到 /api/room/null/ws 永远收不到 welcome
      lobby = new window.GameLobby({
        onReady: function () { if (online) online.sendReady(); },
        onStart: function () { if (online) online.sendStart(); },
        onNotify: function () { if (online) online.sendNotify(); window.Notify.show('已提醒对方准备', 'info'); },
        onLeave: function () { if (online) online.sendLeave(); location.href = 'battleship-online.html'; }
      });
      lobby.show(room);
      lobby.setStatus('连接中…', 'connecting');
      bindOnline(online);
      online.connect(role === 'host' ? 0 : 1);
    } else {
      location.href = 'battleship.html';
    }
  }

  boot();

  window.BattleshipGame = {
    get state() { return state; },
    get mode() { return mode; },
    get phase() { return phase; },
    get onlineMode() { return onlineMode; },
    get myPlayer() { return myPlayer; },
    engine: B
  };
})();
