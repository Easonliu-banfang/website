/* 八球台球 —— 交互控制器（模式解析 / 回合管理 / 物理循环 / 操控 / AI / 规则结算） */
(function () {
  'use strict';

  var P = window.PoolPhys;
  var Rules = window.PoolRules;
  var AI = window.PoolAI;

  function $(id) { return document.getElementById(id); }

  var canvas = $('poolCanvas');
  var R = new window.PoolRender(canvas);

  var mode = 'local';
  var isAI = false;
  var aiSide = 1;

  /* 联机 */
  var onlineMode = false;
  var online = null;
  var myPlayer = 0;
  var roomStarted = false;
  var currentRoom = null;
  var connOk = false;
  var lastShotByMe = false;   // 当前这一杆是否由本端发起（本端用本地乐观仿真，否则用服务端 live 驱动）
  var liveTarget = null;      // 服务端 live 快照 {id:{x,y}}
  var lobby = null;

  var world = null;
  var match = null;

  var busy = false;        // 是否正在打杆/球在动（锁定输入）
  var phase = 'aim';       // 'aim' | 'place' | 'moving' | 'choose' | 'over'
  var shotStartT = 0;
  var shootResult = null;

  var aim = { x: 1, y: 0 };
  var power = 0.45;
  var top = 0.25;          // -1 拉杆 .. 1 高杆
  var side = 0;            // -1 左塞 .. 1 右塞

  var placing = null;      // 自由球放置：{x,y}
  var placeKind = null;
  var placeOK = false;

  var callPocket = null;   // 打黑八时报袋的袋口索引
  var needCall = false;    // 目标只剩黑八 → 必须报袋

  var charging = null;     // 蓄力拖拽 {downX,downY}
  var aimLocked = null;    // 按下后锁定的瞄准方向（蓄力期间不再随鼠标转）
  var aimTarget = null;    // 鼠标期望方向（循环中平滑逼近，避免抖动/180°翻转）
  var aiTimer = null;
  var gameSeq = 0;         // 新局令牌：作废旧 AI 计时

  /******** 元素 ********/
  var elTurn = $('poolTurn'), elGroup0 = $('poolGroup0'), elGroup1 = $('poolGroup1');
  var elLeft0 = $('poolLeft0'), elLeft1 = $('poolLeft1');
  var elHint = $('poolHint');
  var modal = $('poolModal'), modalTitle = $('poolModalTitle'), modalSub = $('poolModalSub');
  var btnNew = $('poolNew'), btnClose = $('poolModalClose');
  var choose = $('poolChoose'), btnSolid = $('poolChooseSolid'), btnStripe = $('poolChooseStripe');

  /******** 基础 ********/
  function notify(text, type) {
    if (window.Notify) window.Notify.show(text, type || 'info');
  }

  function whoName(p) {
    if (mode === 'ai') return p === aiSide ? '电脑' : '你';
    if (mode === 'online') return p === myPlayer ? '你' : '对手';
    return '玩家' + (p === 0 ? '一' : '二');
  }

  function groupLabel(g) { return g ? Rules.groupName(g) : '未定'; }

  function newGame() {
    gameSeq++;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    world = P.createWorld((Math.random() * 1e9) | 0);
    P.setup(world, P.rackBalls((Math.random() * 1e9) | 0));
    match = Rules.createMatch();
    busy = false; phase = 'aim';
    callPocket = null; needCall = false; placing = null; placeKind = null;
    power = 0.45; top = 0.25; side = 0; aim = { x: 1, y: 0 };
    hideModal(); hideChoose();
    notify('开球：' + whoName(match.turn) + ' 先手', 'info');
    syncUI();
    R.resize();
    if (isAI && match.turn === aiSide) scheduleAI();
  }

  function reRack() {
    // 开球进黑八：重新摆球，由原开球方再开（保留 turn）
    var who = match.turn;
    world = P.createWorld((Math.random() * 1e9) | 0);
    P.setup(world, P.rackBalls((Math.random() * 1e9) | 0));
    match = Rules.createMatch();
    match.turn = who;
    match.isBreak = true;
    busy = false; phase = 'aim';
    callPocket = null; needCall = false; placing = null;
    notify('重新摆球，' + whoName(match.turn) + ' 再次开球', 'warn');
    syncUI();
    if (isAI && match.turn === aiSide) scheduleAI();
  }

  /******** 桌面分组状态 ********/
  function countGroupLeft(g) {
    var n = 0;
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (b.dead || b.type === 0) continue;
      if (Rules.groupOf(b.type) === g) n++;
    }
    return n;
  }

  function syncUI() {
    if (elTurn) elTurn.textContent = whoName(match.turn) + (match.isBreak ? '（开球）' : '') + (match.hand ? ' · 自由球' : '');
    if (elGroup0) elGroup0.textContent = groupLabel(match.groups[0]);
    if (elGroup1) elGroup1.textContent = groupLabel(match.groups[1]);
    if (elLeft0) elLeft0.textContent = match.groups[0] ? countGroupLeft(match.groups[0]) : '—';
    if (elLeft1) elLeft1.textContent = match.groups[1] ? countGroupLeft(match.groups[1]) : '—';
    if (elHint) {
      if (phase === 'place') elHint.textContent = '移动鼠标/手指放置白球，点击确认落点';
      else if (phase === 'choose') elHint.textContent = '同一杆进了两种球，请选择你的组';
      else if (busy) elHint.textContent = '球在滚动…';
      else if (needCall) elHint.textContent = '打黑八需报袋：点击目标袋口（高亮闪烁）';
      else if (onlineMode && match.turn !== myPlayer) elHint.textContent = '对手回合，等待对方击球…';
      else elHint.textContent = '移动鼠标瞄准 · 按住并拖拽蓄力 · 松开击球（方向按下即锁定）｜W/S 力度 Q/E 旋转 Z/C 高低杆 空格击球';
    }
  }

  /******** 操控：坐标 ********/
  function toWorld(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - R.ox) / R.scale,
      y: (clientY - rect.top - R.oy) / R.scale
    };
  }

  function cueBall() {
    for (var i = 0; i < world.balls.length; i++) {
      if (world.balls[i].type === 0 && !world.balls[i].dead) return world.balls[i];
    }
    return null;
  }

  function setAimByPointer(cx, cy) {
    var cue = cueBall();
    if (!cue) return;
    var dx = cx - cue.x, dy = cy - cue.y;
    var d = Math.hypot(dx, dy);
    if (d < 1e-4) return;   // 恰好压在球心才不更新（防 normalize(0,0)）；其余位置始终跟随鼠标
    aimTarget = { x: dx / d, y: dy / d };
    if (aimLocked === null) aim = aimTarget;
  }

  /* 平滑转向：把 aim 朝 target 插值（角度空间） */
  function easeAim() {
    if (!aimTarget || aimLocked !== null || busy) return;
    var cur = Math.atan2(aim.y, aim.x);
    var tgt = Math.atan2(aimTarget.y, aimTarget.x);
    var diff = tgt - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    var step = diff * 0.28;
    var n = cur + step;
    aim = { x: Math.cos(n), y: Math.sin(n) };
    if (Math.abs(diff) < 0.004) aim = aimTarget;
  }

  /******** 开火 ********/
  function fire() {
    var cue = cueBall();
    if (!cue || busy || phase === 'moving' || phase === 'over') return;
    if (phase === 'place') return;          // 必须先落位
    if (onlineMode && match.turn !== myPlayer) return;
    if (needCall && callPocket === null) { notify('请先点击要报的袋口', 'warn'); return; }
    if (phase === 'choose') return;
    var targets = Rules.legalTargets(match, world);
    if (targets.length === 0) { notify('桌面上没有你的目标球', 'warn'); return; }

    busy = true;
    phase = 'moving';
    // 记录杆始状态（事件基线）
    world.cueFirstContactT = null;
    world.railEvents = [];
    shotStartT = world.simTime;
    var basePocketed = world.pocketed.length;
    var shotParams = { aimX: aim.x, aimY: aim.y, power: Math.max(0.06, power), top: top, side: side, callPocket: needCall ? callPocket : null };
    if (match.isBreak) { world.breakMode = true; cue.breakSpeed = 16; }   // 开球：白球更高初速炸开球堆
    P.strike(cue, shotParams.aimX, shotParams.aimY, shotParams.power, top, side);
    world.quiet = false;      // 防陈旧静止标志 → 结算器过早触发
    syncUI();

    if (onlineMode) {
      // 联机：本地乐观仿真 + 上报服务端权威结算（本端动画与服务器一致）
      lastShotByMe = true;
      liveTarget = null;
      if (online) online.sendShoot(shotParams);
      return;   // 等服务端 live/state
    }

    // 等待物理静止后结算（由 loop 驱动）
    waitSettle().then(function () {
      settleShot(basePocketed);
    });
  }

  function waitSettle() {
    return new Promise(function (resolve) { (function check() { if (world.quiet) { resolve(); } else { setTimeout(check, 30); } })(); });
  }

  function settleShot(basePocketed) {
    var shot = Rules.analyzeShot(world, shotStartT);
    shot.basePocketed = basePocketed;
    // 报袋校验（严格规则：黑八进非报袋 → 判负）
    if (callPocket !== null && shot.pocketed.indexOf(8) >= 0) {
      var eight = null;
      for (var i = basePocketed; i < world.pocketed.length; i++) {
        if (world.pocketed[i].type === 8) { eight = world.pocketed[i]; break; }
      }
      if (eight && callPocket !== eight.pocketIdx) {
        match.winner = 1 - match.turn;
        match.loser = match.turn;
        match.note = '黑八进错袋（报 ' + pocketName(callPocket) + ' 却进了 ' + pocketName(eight.pocketIdx) + '），' + whoName(match.turn) + ' 判负';
        showOver();
        return;
      }
    }
    var res = Rules.resolveShot(match, world, shot);
    shootResult = res;
    applyResult(res);
  }

  function pocketName(i) {
    var names = ['左上', '右上', '左下', '右下', '上中', '下中'];
    return names[i] || ('袋口' + i);
  }

  function applyResult(res) {
    if (res.note) notify(res.note, res.foul ? 'warn' : (res.win !== null ? 'win' : 'info'));
    // 重摆 / 胜负 / 自由球 / 选组
    if (res.reRack) {
      // 重置后 true：由首开方再开（保持 match.turn 为原开球方）
      world = P.createWorld((Math.random() * 1e9) | 0);
      P.setup(world, P.rackBalls((Math.random() * 1e9) | 0));
      var who = match.turn;
      match = Rules.createMatch();
      match.turn = who; match.isBreak = true;
      resetShotFlags();
      syncUI();
      scheduleTurn();
      return;
    }
    if (res.win !== null || res.loss !== null) { match.winner = match.winner !== null ? match.winner : res.win; showOver(); return; }
    if (res.chooseGroup) {
      phase = 'choose';
      if (mode === 'ai' && match.turn === aiSide) { chooseGroup(true); return; }  // AI 默认选全色
      showChoose();
      syncUI();
      return;
    }
    if (res.foul) {
      // ★ 犯规必须先把回合交给对手（res.turn = 对方），否则 AI/面对面模式下轮到对手却永远不动
      match.turn = res.turn;
      match.hand = res.hand;
      phase = 'place';
      placing = null; placeOK = false; placeKind = res.hand.kind;
      // 白球落袋 → 从桌面移除，进入自由球放球
      var cue = cueBall();
      if (cue) { cue.dead = true; removeFromWorld(cue); }
      if (mode === 'ai' && match.turn === aiSide) { scheduleAI(); return; }
      notify('犯规：' + res.reason + '，' + whoName(res.hand.forPlayer) + ' 自由球', 'warn');
      busy = false;                 // 只清 busy，保留 phase='place'（对手要落位）
      syncUI();
      return;
    }
    // 正常续局
    match.hand = null;
    resetShotFlags();
    match.turn = res.turn;
    syncUI();
    scheduleTurn();
  }

  function resetShotFlags() { callPocket = null; needCall = false; busy = false; phase = 'aim'; }

  function removeFromWorld(b) {
    var i = world.balls.indexOf(b);
    if (i >= 0) world.balls.splice(i, 1);
  }

  function scheduleTurn() {
    if (match.winner !== null || match.loser !== null) return;
    updateNeedCall();
    if (match.turn === aiSide && mode === 'ai') scheduleAI();
    else phase = 'aim';
  }

  function updateNeedCall() {
    var targets = Rules.legalTargets(match, world);
    needCall = targets.length === 1 && targets[0] === 8;
    if (needCall && callPocket === null) {
      // 默认报最近袋口
      var eight = null;
      for (var i = 0; i < world.balls.length; i++) if (world.balls[i].type === 8 && !world.balls[i].dead) { eight = world.balls[i]; break; }
      if (eight) callPocket = nearestPocket(eight);
    }
  }

  function nearestPocket(b) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < P.POCKETS.length; i++) {
      var pk = P.POCKETS[i];
      var d = Math.hypot(pk.x - b.x, pk.y - b.y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /******** AI ********/
  function scheduleAI() {
    if (aiTimer) clearTimeout(aiTimer);
    var seq = gameSeq;
    aiTimer = setTimeout(function () {
      if (seq !== gameSeq || match.winner !== null || match.loser !== null) return;
      aiTimer = setTimeout(function () {
        if (seq !== gameSeq) return;
        aiAct();
      }, 500);
    }, 600);
  }

  function aiAct() {
    if (seqGuard()) return;
    var me = aiSide;
    var d = AI.decide(world, match, me, { rnd: Math.random });
    if (!d || !d.shot) { notify('电脑思考中…', 'info'); scheduleAI(); return; }
    if (d.place) {
      var handKind = match.hand ? match.hand.kind : null;
      var px = d.place.x, py = d.place.y;
      if (handKind === 'behindHead') px = Math.min(px, P.TABLE_W * 0.25);
      if (!Rules.canPlaceCue(world, px, py, handKind)) { scheduleAI(); return; }
      var dead = cueBall();
      if (!dead) { world.balls.push(P.makeBall(0, px, py, 0)); }
      else { dead.x = px; dead.y = py; dead.vx = 0; dead.vy = 0; }
      match.hand = null;
      // 关键：犯规后 phase 仍是 'place'，不切回 'aim' 会导致 fire() 直接 return（电脑自由球无反应）
      phase = 'aim'; busy = false;
      syncUI();
    }
    // 打黑八报袋
    if (needCall && d.shot.pocket !== undefined && d.shot.pocket >= 0) callPocket = d.shot.pocket;
    aim = { x: d.shot.aimX, y: d.shot.aimY };
    power = d.shot.power;
    top = d.shot.top !== undefined ? d.shot.top : 0.3;
    side = d.shot.side || 0;
    syncUI();
    var seq = gameSeq;
    setTimeout(function () {
      if (seq !== gameSeq) return;
      if (busy || match.winner !== null || match.loser !== null) return;
      fire();
    }, 700);
  }

  function seqGuard() { return false; }

  /******** 选组 ********/
  function chooseGroup(chooseSolid) {
    var shooter = match.turn;
    var g = chooseSolid ? 'solid' : 'stripe';
    if (onlineMode) {
      // 联机：上传选择，服务端权威分组后广播
      hideChoose(); phase = 'aim'; busy = false;
      if (online) online.sendChoose(g);
      return;
    }
    match.groups[shooter] = g;
    match.groups[1 - shooter] = g === 'solid' ? 'stripe' : 'solid';
    hideChoose();
    phase = 'aim';
    busy = false;
    notify(whoName(shooter) + ' 选择了' + Rules.groupName(g), 'info');
    syncUI();
    if (mode === 'ai' && match.turn === aiSide) scheduleAI();
  }

  /******** 胜负弹窗 ********/
  function showOver() {
    phase = 'over';
    var winner = match.winner;
    var isHuman = (mode === 'ai') ? (winner === 0) : true;
    modalTitle.textContent = isHuman ? '🎉 恭喜获胜！' : '😶 电脑获胜';
    modalSub.textContent = match.note || '本局结束';
    modal.hidden = false;
    syncUI();
  }
  function hideModal() { modal.hidden = true; }
  function showChoose() { choose.hidden = false; }
  function hideChoose() { choose.hidden = true; }

  /******** 输入：指针 ********/
  function canvasPos(ev) {
    var r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (mode === 'ai' && match.turn === aiSide) return;
    if (busy || phase === 'over' || phase === 'moving') return;
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    var wx = canvasPos(ev);
    var w = toWorld(wx.x, wx.y);
    if (phase === 'place') {
      // 落位：直接移动到指针处，点击 = 放置
      if (placeOK) { confirmPlace(); }
      return;
    }
    if (phase === 'choose') return;
    // 报袋：点袋口直接选中
    if (needCall) {
      var pi = pocketAt(w.x, w.y);
      if (pi !== null) { callPocket = pi; syncUI(); return; }
    }
    // 按下：先把方向对准「落点相对白球」的方向（避免沿用还没缓动到位的旧瞄准），再锁定蓄力
    setAimByPointer(w.x, w.y);
    aimLocked = aim;
    charging = { downX: wx.x, downY: wx.y };
    power = 0.25;
    syncUI();
  });

  canvas.addEventListener('pointermove', function (ev) {
    var wx = canvasPos(ev);
    var w = toWorld(wx.x, wx.y);
    if (phase === 'place') {
      placing = clampPlace(w.x, w.y);
      placeOK = placing ? P.canPlace(world, placing.x, placing.y) : false;
      syncUI();
      return;
    }
    // 报袋高亮悬停
    if (needCall && !charging) {
      var pi = pocketAt(w.x, w.y);
      if (pi !== null) { callPocket = pi; syncUI(); return; }
    }
    if (busy || phase === 'moving' || phase === 'over') return;
    if (charging) {
      // 蓄力：只取拖拽距离（任意方向都行），方向保持锁定
      var dx = wx.x - charging.downX, dy = wx.y - charging.downY;
      power = clamp01(0.25 + Math.hypot(dx, dy) / 210);
      syncUI();
    } else {
      setAimByPointer(w.x, w.y);
    }
  });

  function onPointerUp(ev) {
    if (phase === 'place') return;
    if (charging) {
      charging = null;
      aimLocked = null;
      if (!busy && phase === 'aim') fire();
    }
  }
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', function () { charging = null; aimLocked = null; });

  /* 白球落位辅助 */
  function clampPlace(x, y) {
    if (!x) return null;
    var r = P.R;
    return {
      x: Math.max(r, Math.min(P.TABLE_W - r, x)),
      y: Math.max(r, Math.min(P.TABLE_H - r, y))
    };
  }

  function confirmPlace() {
    if (!placing || !placeOK) return;
    if (onlineMode) {
      // 联机：上传落点，由服务端校验并广播权威状态（收到 state 后 phase 自动转为 aim）
      var px = placing.x, py = placing.y;
      placing = null; busy = false;
      if (online) online.sendPlaceCue(px, py);
      return;
    }
    var cue = cueBall();
    if (!cue) { world.balls.push(P.makeBall(0, placing.x, placing.y, 0)); }
    else { cue.x = placing.x; cue.y = placing.y; cue.vx = 0; cue.vy = 0; }
    match.hand = null;
    placing = null; phase = 'aim'; busy = false;
    notify(whoName(match.turn) + ' 已放置白球，请瞄准', 'info');
    syncUI();
    if (mode === 'ai' && match.turn === aiSide) scheduleAI();
  }

  /* 袋口命中（世界坐标） */
  function pocketAt(x, y) {
    for (var i = 0; i < P.POCKETS.length; i++) {
      var pk = P.POCKETS[i];
      var d = Math.hypot(pk.x - x, pk.y - y);
      if (d < pk.r * 2.2) return i;
    }
    return null;
  }
  function nearPocket(x, y) { return pocketAt(x, y) !== null; }

  /******** 输入：键盘 ********/
  window.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if (k === ' ') { ev.preventDefault(); fire(); return; }
    if (busy || phase === 'moving' || phase === 'over') return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { aim = rotateAim(-0.04); return; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { aim = rotateAim(0.04); return; }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { power = clamp01(power + 0.04); syncUI(); return; }
    if (k === 'ArrowDown' || k === 's' || k === 'S') { power = clamp01(power - 0.04); syncUI(); return; }
    if (k === 'q' || k === 'Q') { side = clamp(-1, 1, side - 0.2); syncUI(); return; }
    if (k === 'e' || k === 'E') { side = clamp(-1, 1, side + 0.2); syncUI(); return; }
    if (k === 'z' || k === 'Z') { top = clamp(-1, 1, top - 0.25); syncUI(); return; }
    if (k === 'c' || k === 'C') { top = clamp(-1, 1, top + 0.25); syncUI(); return; }
  });

  function rotateAim(a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: aim.x * c - aim.y * s, y: aim.x * s + aim.y * c };
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function clamp(a, b, v) { return v < a ? a : (v > b ? b : v); }

  /******** 按钮 ********/
  if (btnNew) btnNew.addEventListener('click', function () {
    if (onlineMode) { if (online) online.sendReset(); notify('已请求重置棋局', 'info'); return; }
    newGame();
  });
  if (btnClose) btnClose.addEventListener('click', function () {
    hideModal();
    if (onlineMode) { if (online) online.sendReset(); }
    else newGame();
  });
  if (btnSolid) btnSolid.addEventListener('click', function () { if (phase === 'choose') chooseGroup(true); });
  if (btnStripe) btnStripe.addEventListener('click', function () { if (phase === 'choose') chooseGroup(false); });

  /******** 联机：绑定事件 ********/
  function bindOnline(o) {
    o.on('welcome', function (p) {
      myPlayer = p; connOk = true;
      if (lobby) { lobby.show(currentRoom); lobby.setStatus('已连接，等待双方准备', 'connected'); }
    });
    o.on('lobby', function (d) {
      var fromGame = roomStarted;
      myPlayer = d.you; connOk = true;
      roomStarted = !!d.started;
      if (lobby) {
        if (d.started) { lobby.hide(); }
        else { lobby.show(currentRoom); lobby.render(d); }
      }
    });
    o.on('started', function () { roomStarted = true; if (lobby) lobby.hide(); });
    o.on('state', function (v) {
      if (!v || v.kind !== 'pl') return;
      connOk = true; roomStarted = true;
      if (lobby) lobby.hide();
      applyServerState(v);
    });
    o.on('live', function (m) {
      if (!m || !m.balls || !m.balls.length) return;
      if (lastShotByMe) return;   // 本端自己这杆：用本地乐观仿真，不用 live 驱动
      liveTarget = {};
      for (var i = 0; i < m.balls.length; i++) liveTarget[m.balls[i].id] = { x: m.balls[i].x, y: m.balls[i].y };
    });
    o.on('disband', function () {});
    o.on('players', function (ps) {
      var opp = !!(ps[1 - myPlayer]);
      if (!roomStarted) { if (lobby) lobby.setStatus(opp ? '双方已就位，准备开始' : '等待对手加入…', opp ? 'connected' : 'connecting'); return; }
      if (!opp) notify('对手已退出/断开连接，对局暂停', 'warn');
      else notify('对局进行中', 'info');
    });
    o.on('status', function (s) {
      if (s.state === 'connecting') { connOk = false; }
      else if (s.state === 'connected') { connOk = true; }
      else if (s.state === 'reconnecting') { connOk = false; notify(s.detail || '连接中断，重连中…', 'warn'); }
      else if (s.state === 'disconnected') { connOk = false; notify(s.detail || '连接已断开', 'error'); }
    });
    o.on('error', function (msg) { notify('错误：' + msg, 'error'); });
    o.on('close', function () { connOk = false; notify('连接已断开，点击新局可重连', 'error'); });
  }

  /* 重建本地世界/匹配（服务端权威状态） */
  function applyServerState(v) {
    var nw = P.createWorld();
    nw.balls = v.balls.map(function (b) {
      var nb = P.makeBall(b.id, b.x, b.y, b.type);
      nb.vx = b.vx || 0; nb.vy = b.vy || 0; nb.w = b.w || 0; nb.s = b.s || 0; nb.dead = !!b.dead;
      nb.ghost = false;
      return nb;
    });
    nw.pocketed = (v.pocketed || []).map(function (pe) { return { type: pe.type, pocketIdx: pe.pocketIdx, t: pe.t, ball: {} }; });
    nw.simTime = v.simTime || 0; nw.time = nw.simTime; nw.quiet = true;
    world = nw;
    // 还原白球对象引用到 pocketed（渲染只用 type，无需）
    match = JSON.parse(JSON.stringify(v.match));
    callPocket = (v.callPocket != null) ? v.callPocket : null;
    if (v.note) notify(v.note, 'info');
    busy = false; phase = 'aim'; placing = null; liveTarget = null;
    lastShotByMe = false; hideChoose();
    var st = match;
    if (st.winner !== null || st.loser !== null) { showOver(); return; }
    needCall = false;
    if (st.needsChoose && st.turn === myPlayer) { phase = 'choose'; showChoose(); }
    else if (st.needsChoose) { phase = 'aim'; }
    else if (st.hand && st.hand.forPlayer === myPlayer) { phase = 'place'; placing = null; placeOK = false; }
    else if (st.hand) { phase = 'aim'; }
    else { phase = 'aim'; updateNeedCall(); }
    syncUI();
  }

  /* 联机启动：mode=online&room=CODE&role=host|guest */
  function startOnline(room, role) {
    mode = 'online'; onlineMode = true; myPlayer = role === 'host' ? 0 : 1;
    currentRoom = room; roomStarted = false;
    if (lobby) lobby.hide();
    online = new window.PoolOnline();
    online.code = room;
    lobby = new window.GameLobby({
      onReady: function () { if (online) online.sendReady(); },
      onStart: function () { if (online) online.sendStart(); },
      onNotify: function () { if (online) online.sendNotify(); },
      onLeave: function () { if (online) online.sendLeave(); location.href = 'pool.html'; },
    });
    lobby.show(room);
    bindOnline(online);
    online.connect(role === 'host' ? 0 : 1).then(function () {}, function () {});
  }

  /******** 主循环 ********/
  var lastT = 0;
  function loop(ts) {
    if (!world) { requestAnimationFrame(loop); return; }
    // 联机且对方出杆中：用服务端 live 帧驱动位置（本端不做本地物理推进）
    if (onlineMode && liveTarget) {
      var any = false;
      for (var i = 0; i < world.balls.length; i++) {
        var b = world.balls[i];
        var t = liveTarget[b.id];
        if (!t) continue;
        var dx = t.x - b.x, dy = t.y - b.y;
        b.vx = dx * 10; b.vy = dy * 10;
        b.x += dx * 0.42; b.y += dy * 0.42;
        any = true;
      }
      if (!any) liveTarget = null;
    } else if (busy && phase === 'moving' && !world.quiet) {
      var dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 1 / 60;
      P.step(world, dt);
    } else {
      easeAim();   // 瞄准平滑（未在蓄力/持球移动时）
    }
    lastT = ts;
    // 绘制
    var myTurnAim = onlineMode
      ? (match.turn === myPlayer && !busy && phase === 'aim')
      : ((!busy || phase === 'aim') && match.turn !== aiSide);
    var ui = {
      aim: myTurnAim ? aim : null,
      power: power, top: top, side: side,
      charging: !!charging,
      placing: phase === 'place' ? placing : null,
      placeOK: placeOK,
      callPocket: needCall ? callPocket : null,
      _world: world,
    };
    R.draw({ state: { world: world, match: match, ui: ui } });
    requestAnimationFrame(loop);
  }

  /******** 启动 ********/
  function boot() {
    var q = (location.search || '').substr(1);
    var params = {};
    q.split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); params[p[0]] = decodeURIComponent(p[1] || ''); });
    R.resize();
    window.addEventListener('resize', function () { R.resize(); });
    requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(loop); });
    if (params.mode === 'online') {
      var room = params.room || '';
      if (!room) {
        // 无房间码：进入即建房（房主），等待室展示房间码 + 分享 + 开始
        mode = 'online'; onlineMode = true;
        var o = new window.PoolOnline();
        o.createRoom().then(function (code) {
          startOnline(code, 'host');
        }, function () { notify('建房失败，请检查网络', 'error'); });
        return;
      }
      startOnline(room, params.role === 'host' ? 'host' : 'guest');
      return;
    }
    mode = params.mode === 'ai' ? 'ai' : 'local';
    isAI = mode === 'ai';
    aiSide = 1;
    newGame();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();