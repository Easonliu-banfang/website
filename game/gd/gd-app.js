/* 掼蛋（Guandan）前端：等待室(GameLobby) → 贡还贡 → 出牌 → 结算
 * 引擎（gd-engine.js）前后端共用：牌型提示、级牌/逢人配渲染。
 */
(function () {
  'use strict';

  var q = {};
  location.search.replace(/[?&]([^=]+)=([^&]*)/g, function (_, k, v) { q[k] = decodeURIComponent(v); });

  var o = null, me = -1, names = null, isHost = false;
  var state = null, lobby = null, roomStarted = false;
  var selected = [];          // 当前选中的手牌（card 编码）
  var mode = '4p';
  var currentRoom = q.room || '';

  var el = {};
  function $(id) { return document.getElementById(id); }

  var RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '王', 16: '王' };
  var SUIT_CH = ['♦', '♣', '♠', '♥'];
  var SHAPE_LABELS = { single: '单张', pair: '对子', trio: '三张', trioPlusPair: '三带二', trioRun: '三连对', steel: '钢板', straight: '顺子', flushStraight: '同花顺', bomb: '炸弹', jokerBomb: '天王炸' };

  /* ---------- 卡牌渲染 ---------- */
  function cardHtml(card, level, small, cls) {
    var code = GD.codeOf(card), suit = GD.suitOf(card);
    var isJk = GD.isJoker(card);
    var label = isJk ? (code === 16 ? '大王' : '小王') : (RANK_LABEL[code] || String(code));
    var sc = isJk ? 'jk' : ((suit === 1 || suit === 2) ? 'b' : 'r');
    var extra = ' ' + (cls || '') + (small ? ' small' : '');
    var lvTag = (code === level && !isJk) ? ' lv' : '';
    var wildTag = GD.isWild(card, level) ? ' wild' : '';
    var suitCh = isJk ? (code === 16 ? '★' : '☆') : SUIT_CH[suit];
    return '<div class="gcard ' + sc + extra + lvTag + wildTag + '">' +
      '<div class="cr">' + label + '</div><div class="cs">' + suitCh + '</div></div>';
  }
  function seats() {
    var spots = [];
    for (var s = 0; s < 4; s++) if (s !== me) spots.push(s);
    var posMap = ['top', 'left', 'right'];   // 下家(1)=右?：座位1在右、2在上（队友）、3在左
    var pm = ['right', 'top', 'left'];
    var out = [];
    for (var i = 0; i < spots.length; i++) out.push({ seat: spots[i], pos: pm[i % 3] });
    return out;
  }
  function seatName(s) { return (names && names[s]) ? names[s] : ('玩家 ' + (s + 1)); }
  function teamCls(s) { return (s % 2) === (me % 2) ? ' ta' : ' tb'; }

  /* ---------- 渲染 ---------- */
  function renderInfo() {
    if (!state) return;
    $('handNo').textContent = state.handNo || 1;
    $('levelTag').textContent = state.level;
    var myTeam = me % 2;
    $('teamA').textContent = (myTeam === 0 ? '我方 ' : '对方 ') + state.levels[0] + ' 级';
    $('teamB').textContent = (myTeam === 0 ? '对方 ' : '我方 ') + state.levels[1] + ' 级';
  }

  function renderPlayers() {
    var top = '', left = '', right = '';
    seats().forEach(function (it) {
      var s = it.seat;
      var isTurn = state && state.turn === s && state.phase === 'playing';
      var html = '<div class="gd-p-card' + (isTurn ? ' turn' : '') + '">' +
        '<div class="gd-p-avatar">👤</div>' +
        '<div class="gd-p-name' + teamCls(s) + '">' + seatName(s) + '</div>' +
        '<span class="gd-p-cnt">' + ((state && state.counts[s]) || 0) + ' 张</span>' +
        '<div class="gd-p-play" id="play' + s + '"></div>' +
        '</div>';
      if (it.pos === 'top') top = html; else if (it.pos === 'left') left = html; else right = html;
    });
    $('playerTop').innerHTML = top;
    $('playerLeft').innerHTML = left;
    $('playerRight').innerHTML = right;
    $('meLabel').textContent = seatName(me);
  }

  function renderCenter() {
    var tip = $('turnTip'), lastc = $('lastCards'), phase = $('phaseTip');
    if (!state) return;
    // 阶段提示
    if (state.phase === 'tribute') {
      tip.textContent = '进贡阶段';
      phase.textContent = state.tribute && state.tribute.resisted ? '（抗贡成功，跳过进贡）' : '败方需进贡手中最大的牌（逢人配除外）';
      lastc.innerHTML = '';
      return;
    }
    if (state.phase === 'tributeReturn') {
      tip.textContent = '还贡阶段';
      phase.textContent = '收贡者需还一张 ≤10 的牌';
      lastc.innerHTML = '';
      return;
    }
    if (state.phase === 'handOver' || state.phase === 'matchOver') {
      tip.textContent = state.phase === 'matchOver' ? '整场结束！' : '本局结束';
      phase.textContent = '';
      lastc.innerHTML = '';
      return;
    }
    var isMine = state.turn === me;
    tip.textContent = isMine ? '轮到你出牌' : ('轮到 ' + seatName(state.turn));
    phase.textContent = '';
    // 桌面：上一手牌（自己出的已在 trick 中，这里显示 last 的牌）
    if (state.last) {
      var h = '';
      var who = seatName(state.last.seat);
      h = '<div style="font-size:11px;color:rgba(255,255,255,.85);margin-bottom:4px">' + who + '</div>';
      state.last.cards.forEach(function (c) {
        h += cardHtml(c, state.level, true);
      });
      var sh = state.last.shape;
      if (sh) h += '<div style="font-size:11px;color:#ffe9ad;margin-top:3px">' + (SHAPE_LABELS[sh.k] || sh.k) + '</div>';
      lastc.innerHTML = h;
    } else {
      lastc.innerHTML = '<div style="color:rgba(255,255,255,.8);font-size:12px">新的一轮 · 由 ' + seatName(state.leader) + ' 首出</div>';
    }
  }

  function renderTricks() {
    // 各玩家最近出的跟牌显示在其席位旁
    if (!state || !state.trick) return;
    for (var s = 0; s < 4; s++) {
      var elx = $('play' + s);
      if (!elx) continue;
      elx.innerHTML = '';
    }
    state.trick.forEach(function (t) {
      var elx = $('play' + t.seat);
      if (!elx) return;
      if (t.pass) { elx.innerHTML = '<span style="font-size:11px;color:#94a3b8">不出</span>'; return; }
      var h = '';
      t.cards.forEach(function (c) { h += cardHtml(c, state.level, true); });
      elx.innerHTML = h;
    });
  }

  function myPlayable() {
    if (!state || state.phase !== 'playing' || state.turn !== me) return { canPlay: false, canPass: false };
    var canPass = !!state.last;
    return { canPlay: true, canPass: canPass };
  }

  function renderHand() {
    if (!state || !state.hand) { $('myHand').innerHTML = ''; return; }
    var hand = GD.sortHand(state.hand, state.level);
    var html = '';
    for (var i = 0; i < hand.length; i++) {
      var c = hand[i];
      var sel = selected.indexOf(c) >= 0 ? ' sel' : '';
      html += '<div class="gc-wrap' + sel + '" data-card="' + c + '">' + cardHtml(c, state.level, false) + '</div>';
    }
    $('myHand').innerHTML = html;
    updateActions();
  }

  function refreshShape() {
    var tag = $('shapeTag');
    if (selected.length === 0) { tag.className = 'gd-shape-tag'; tag.textContent = ''; return; }
    var interps = GD.interpret(selected, state.level);
    if (!interps.length) { tag.className = 'gd-shape-tag show'; tag.textContent = '不成牌型'; return; }
    var sh = interps[0];
    var beatsTxt = '';
    if (state.last) {
      beatsTxt = GD.beats(sh, state.last.shape) ? ' ✓ 压得过' : ' ✗ 压不过';
    }
    tag.className = 'gd-shape-tag show';
    tag.textContent = (SHAPE_LABELS[sh.k] || sh.k) + beatsTxt;
  }

  function updateActions() {
    var pb = $('btnPlay'), pp = $('btnPass'), pn = $('btnNext');
    if (!state) return;
    if (state.phase === 'handOver' || state.phase === 'matchOver') {
      pb.hidden = true; pp.hidden = true;
      pn.hidden = !isHost;
      return;
    }
    pn.hidden = true;
    if (state.phase !== 'playing' || state.turn !== me) { pb.disabled = true; pb.textContent = '等待中…'; pp.hidden = true; return; }
    pb.disabled = selected.length === 0;
    pb.textContent = '出牌';
    pp.hidden = !(!!state.last);
    // 无可压时可一键过
    if (state.last && selected.length === 0) {
      pp.classList.remove('on');
    }
  }

  function showResult() {
    var r = $('gdResult');
    var res = state.lastResult;
    if (!res) { r.hidden = true; return; }
    var p0 = res.placements[0];
    var myWin = (p0 % 2) === (me % 2);
    var ups = res.levels[myWin ? (me % 2) : (1 - me % 2)];
    var txt = myWin ? '🎉 我方获胜！' : '😔 对方获胜';
    var sub = '排名：' + res.placements.map(function (s, i) { return (i + 1) + '. ' + seatName(s); }).join('　') +
      '<br>升到 ' + ups + ' 级';
    if (state.phase === 'matchOver') { txt = myWin ? '🏆 整场获胜！通关 A 级！' : '整场结束，对方率先通关 A 级'; }
    r.innerHTML = '<div class="' + (myWin ? 'big' : '') + '">' + txt + '</div><div class="sub">' + sub + '</div>';
    if (isHost && state.phase !== 'matchOver') {
      var btn = document.createElement('button');
      btn.className = 'gd-btn on';
      btn.textContent = '下一局 →';
      btn.addEventListener('click', function () { if (o) o._wsSend({ type: 'gd_deal' }); r.hidden = true; });
      r.appendChild(btn);
    }
    r.hidden = false;
  }

  function render() {
    if (!state) return;
    $('gameRoot').hidden = false;
    if (lobby) lobby.hide();
    renderInfo(); renderPlayers(); renderCenter(); renderTricks(); renderHand();
    selected = [];
    refreshShape();
    // 贡/还贡弹窗
    if (state.phase === 'tribute' && state.tributable && state.tributable.length) {
      openTributeModal('进贡', '交出手中最大的牌（逢人配除外）', state.tributable, 'gd_tribute');
    } else if (state.phase === 'tributeReturn' && state.returnable && state.returnable.length) {
      openTributeModal('还贡', '还一张 ≤10 的牌给对手', state.returnable, 'gd_return');
    } else {
      $('gdModal').hidden = true;
    }
    if (state.phase === 'handOver' || state.phase === 'matchOver') showResult();
    else $('gdResult').hidden = true;
  }

  function openTributeModal(title, desc, cards, msgType) {
    $('modalTitle').textContent = title;
    $('modalDesc').textContent = desc + '——点选一张牌';
    var box = $('modalCards');
    box.innerHTML = '';
    var sorted = GD.sortHand(cards, state.level);
    sorted.forEach(function (c) {
      var wrap = document.createElement('div');
      wrap.innerHTML = cardHtml(c, state.level, false);
      var cardEl = wrap.firstChild;
      cardEl.addEventListener('click', function () {
        if (o) o._wsSend({ type: msgType, card: c });
        $('gdModal').hidden = true;
      });
      box.appendChild(cardEl);
    });
    $('gdModal').hidden = false;
  }

  /* ---------- 交互 ---------- */
  function bindUI() {
    $('myHand').addEventListener('click', function (e) {
      var wrap = e.target.closest('.gc-wrap');
      if (!wrap) return;
      if (!state || state.phase !== 'playing' || state.turn !== me) return;
      var card = Number(wrap.getAttribute('data-card'));
      var idx = selected.indexOf(card);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(card);
      wrap.classList.toggle('sel', idx < 0);
      refreshShape();
      updateActions();
    });
    $('btnPlay').addEventListener('click', function () {
      if (!selected.length) return;
      var interps = GD.interpret(selected, state.level);
      if (!interps.length) { flash('选中的牌不成牌型'); return; }
      // 默认选第一个（最强）解释；若压不过且有其他解释，选能压过的
      var interpId = 0;
      if (state.last) {
        var found = -1;
        for (var i = 0; i < interps.length; i++) {
          if (GD.beats(interps[i], state.last.shape)) { found = i; break; }
        }
        if (found < 0) { flash('压不过上家的牌'); return; }
        interpId = found;
      }
      if (o) o._wsSend({ type: 'gd_play', cards: selected.slice(), interpId: interpId });
      selected = [];
    });
    $('btnPass').addEventListener('click', function () {
      if (o) o._wsSend({ type: 'gd_pass' });
      selected = [];
    });
    $('btnNext').addEventListener('click', function () {
      if (o) o._wsSend({ type: 'gd_deal' });
      $('gdResult').hidden = true;
    });
  }

  function flash(msg) {
    var tip = $('phaseTip');
    if (tip) { tip.textContent = msg; setTimeout(function () { renderCenter(); }, 1200); }
  }

  /* ---------- 状态接收 ---------- */
  function applyState(s) {
    var first = !state || !roomStarted;
    state = s;
    if (s.you != null) me = s.you;
    roomStarted = true;
    render();
  }

  /* ---------- 等待室与连接 ---------- */
  function bindOnline(online) {
    online.onStatus(function (phase) {
      if (!window.Notify) return;
      if (phase === 'connected') window.Notify.show('已连接', 'success');
      else if (phase === 'reconnecting') window.Notify.show('连接中断，正在重连…', 'warn', { sticky: true });
      else if (phase === 'disconnected') window.Notify.show('连接已断开', 'error', { sticky: true });
    });
    online.on('welcome', function () {
      if (lobby) { lobby.show(currentRoom); lobby.setStatus('已连接，等待准备开始', 'connected'); }
    });
    online.on('lobby', function (d) {
      me = d.you;
      names = (d.names && d.names.length) ? d.names : null;
      var fromGame = roomStarted;
      roomStarted = !!d.started;
      if (lobby) {
        if (d.started) { window.Notify.clear('🔔 房主提醒你准备'); lobby.hide(); }
        else {
          if (fromGame && state) { state = null; window.Notify.clearAll(); window.Notify.show('对局已结束，返回房间', 'warn', { sticky: true }); }
          lobby.show(currentRoom);
          lobby.render(d);
          autoFillAI(d);
        }
      }
    });
    online.on('started', function () { roomStarted = true; if (lobby) lobby.hide(); });
    online.on('state', function (s) { applyState(s); });
    online.on('players', function () { if (roomStarted && state) renderPlayers(); });
    online.on('notify', function () { if (window.Notify) window.Notify.show('🔔 房主提醒你准备', 'warn', { sticky: true }); });
    online.on('error', function (msg) { if (msg) flash(msg); });
    online.on('dissolve', function () {
      roomStarted = false;
      if (online) online._intentionalClose = true;
      if (lobby) lobby.hide();
      if (window.Notify) { window.Notify.clearAll(); window.Notify.show('房间已解散，即将返回大厅…', 'error', { sticky: true }); }
      setTimeout(function () { location.href = 'gd-online.html?v=g2'; }, 1800);
    });
    online.on('giveup', function () {
      if (window.Notify) { window.Notify.clearAll(); window.Notify.show('多次重连失败，返回…', 'warn', { sticky: true }); }
      if (online) online._intentionalClose = true;
      setTimeout(function () { location.href = 'gd-online.html?v=g2'; }, 1500);
    });
  }

  /* 人机模式：房主自动补 AI 到 4 人 */
  var aiFilled = 0;
  function autoFillAI(d) {
    if (q.ai !== '1') return;
    if (!isHost || !d || d.started) return;
    if (aiFilled >= 6) return;
    var players = d.players || [];
    var total = 0;
    for (var i = 0; i < players.length; i++) if (players[i]) total++;
    if (total >= 4) return;
    for (var j = 0; j < players.length; j++) {
      if (!players[j]) {
        aiFilled++;
        if (o) { if (o._wsSend) o._wsSend({ type: 'add_ai', slot: j }); else o.send({ type: 'add_ai', slot: j }); }
        return;
      }
    }
  }

  function checkOrientation() {
    var landscape = window.innerWidth >= window.innerHeight;
    el.landscapeOverlay.hidden = landscape;
  }

  function boot() {
    ['landscapeOverlay', 'gameRoot', 'playerTop', 'playerLeft', 'playerRight',
     'topCardImg', 'turnTip', 'lastCards', 'phaseTip', 'meLabel', 'myHand',
     'btnPlay', 'btnPass', 'btnNext', 'gdModal', 'modalTitle', 'modalDesc', 'modalCards',
     'gdResult', 'roomCodeTag', 'unoGameTitle'].forEach(function (id) { el[id] = $(id); });

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', function () { setTimeout(checkOrientation, 120); });
    bindUI();

    if (q.mode !== 'online' || !q.room) {
      if (window.Notify) window.Notify.show('掼蛋目前仅支持联机对战（4 人）', 'error', { sticky: true });
      setTimeout(function () { location.href = 'gd.html'; }, 1800);
      return;
    }

    currentRoom = q.room;
    isHost = q.role === 'host';
    if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + currentRoom; el.roomCodeTag.hidden = false; }

    o = new window.UnoOnline();
    o.code = currentRoom;
    if (window.BotDriver) BotDriver.attach(o, { game: 'gd', delay: function () { return 700 + Math.random() * 900; } });

    lobby = new window.GameLobby({
      onReady: function () { if (o) o.sendReady(); },
      onStart: function () { if (o) o.sendStart(); },
      onNotify: function () { if (o) o.sendNotify(); if (window.Notify) window.Notify.show('已提醒对方准备', 'info'); },
      onLeave: function () { if (o) o.sendLeave(); location.href = 'gd.html'; },
      onAddAI: function (i) { if (o) { if (o._wsSend) o._wsSend({ type: 'add_ai', slot: i }); else o.send({ type: 'add_ai', slot: i }); } },
      onRemoveAI: function (i) { if (o) { if (o._wsSend) o._wsSend({ type: 'remove_ai', slot: i }); else o.send({ type: 'remove_ai', slot: i }); } },
      shareExtra: ''
    });
    lobby.setCapacity(4);        // 掼蛋固定 4 人
    lobby.show(currentRoom);
    lobby.setStatus('连接中…', 'connecting');

    bindOnline(o);
    o.connect(q.role === 'host' ? 0 : 1).catch(function () {
      if (window.Notify) window.Notify.show('连接失败，正在重连…', 'warn', { sticky: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
