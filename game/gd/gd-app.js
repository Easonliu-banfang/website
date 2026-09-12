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

  /* ---------- 渲染（原作者 CardView/SeatPanel/TrickArea/HudBar 结构） ---------- */
  var RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var SUIT_CH = ['♦', '♣', '♠', '♥'];
  var SHAPE_LABELS = { single: '单张', pair: '对子', trio: '三张', trioPlusPair: '三带二', trioRun: '三连对', steel: '钢板', straight: '顺子', flushStraight: '同花顺', bomb: '炸弹', jokerBomb: '天王炸' };
  var PLACE_LABEL = ['头游', '二游', '三游', '末游'];
  var sortMode = 'rank';

  function codeLabel(code) {
    if (code >= 15) return code === 16 ? '大王' : '小王';
    return RANK_LABEL[code] || String(code);
  }
  // 原作者 CardView：红=♦♥(0/3)，黑=♣♠(1/2)；王竖排文字；红桃级牌金边“配”
  function cardHtml(card, level, small, selected, dim) {
    var code = GD.codeOf(card), suit = GD.suitOf(card);
    var jk = GD.isJoker(card);
    var wild = GD.isWild(card, level);
    var cls = ['card'];
    if (small) cls.push('sm');
    if (jk) { cls.push('joker'); cls.push(code === 16 ? 'big' : 'small'); }
    else cls.push((suit === 0 || suit === 3) ? 'red-suit' : 'black-suit');
    if (wild) cls.push('wild-card');
    if (selected) cls.push('selected');
    if (dim) cls.push('dim');
    var inner = jk
      ? '<div class="joker-text">' + (code === 16 ? '大王' : '小王') + '</div>'
      : '<div class="rk">' + codeLabel(code) + '</div><div class="st">' + SUIT_CH[suit] + '</div><div class="big-suit">' + SUIT_CH[suit] + '</div>';
    return '<div class="' + cls.join(' ') + '">' + inner + '</div>';
  }
  function cardsRow(cards, level, small) {
    var sorted = GD.sortHand(cards, level), h = '';
    for (var i = 0; i < sorted.length; i++) h += cardHtml(sorted[i], level, small);
    return h;
  }
  function seatName(s) { return (names && names[s]) ? names[s] : ('玩家 ' + (s + 1)); }
  function seatPos(s) {
    // 座位相对我：1=right(下家) 2=top(对家) 3=left(上家)
    var d = (s - me + 4) % 4;
    return d === 1 ? 'right' : d === 2 ? 'top' : 'left';
  }

  function renderHud() {
    var myTeam = me % 2;
    $('hudLevels').innerHTML =
      '<span class="level-chip ' + (myTeam === 0 ? 'team-blue' : 'team-red') + '">我方（我与对家）· 打 ' + codeLabel(state.levels[myTeam]) + '</span>' +
      '<span class="level-chip ' + (myTeam === 0 ? 'team-red' : 'team-blue') + '">对方 · 打 ' + codeLabel(state.levels[1 - myTeam]) + '</span>' +
      '<span class="level-chip">本局级牌：' + codeLabel(state.level) + '</span>' +
      '<span class="level-chip">第 ' + (state.handNo || 1) + ' 局</span>';
    $('modeTagTxt').textContent = (mode === 'ai') ? '单机模式' : '联机模式';
  }

  function renderSeat(elId, s) {
    var place = state.placements.indexOf(s);
    var isTurn = state.phase === 'playing' && state.turn === s && place < 0;
    var team = s % 2;
    var count = (state.counts && state.counts[s]) || 0;
    var html = '<span class="seat-dot ' + (team === 0 ? 'blue' : 'red') + '"></span>' +
      '<div><div class="seat-name">' + seatName(s) + '</div>' +
      '<div class="seat-count">' + (place >= 0 ? PLACE_LABEL[place] : ('剩 ' + count + ' 张')) + '</div></div>';
    if (place < 0 && count > 0) {
      html += '<div class="seat-cards">';
      for (var i = 0; i < Math.min(count, 13); i++) html += '<span class="mini"></span>';
      if (count > 13) html += '<span style="margin-left:4px;font-size:12px;color:#b9ac8f">…</span>';
      html += '</div>';
    }
    var elx = $(elId);
    elx.innerHTML = html;
    elx.className = 'seat ' + (elId === 'seatTop' ? 'top' : elId === 'seatLeft' ? 'left' : 'right') + (isTurn ? ' turn' : '');
  }

  function renderSeats() {
    for (var s = 0; s < 4; s++) {
      if (s === me) continue;
      var pos = seatPos(s);
      renderSeat('seat' + pos.charAt(0).toUpperCase() + pos.slice(1), s);
    }
  }

  // 中央出牌区：每座位只显示最近一次动作
  function renderTrick() {
    var inner = $('trickInner');
    if (!state || state.phase === 'tribute' || state.phase === 'tributeReturn') { inner.innerHTML = ''; return; }
    var latest = {}, p;
    if (state.trick) for (var i = 0; i < state.trick.length; i++) { p = state.trick[i]; latest[p.seat] = p; }
    var keys = Object.keys(latest);
    if (!keys.length) {
      inner.innerHTML = (state.phase === 'playing' && state.last == null)
        ? '<div style="place-self:center;color:#b9ac8f;font-size:14px">' + seatName(state.leader) + ' 出牌</div>'
        : '';
      return;
    }
    var html = '';
    keys.forEach(function (k) {
      p = latest[k];
      var pos = seatPos(Number(k));
      var body = p.pass
        ? '<span class="pass-mark">不要</span>'
        : '<div style="display:flex;flex-direction:column;align-items:center">' +
          '<div style="display:flex;gap:3">' + cardsRow(p.cards, state.level, true) + '</div>' +
          '<div class="shape-tag">' + (p.shape ? SHAPE_LABELS[p.shape.k] : '') + '</div></div>';
      html += '<div class="trick-play ' + pos + '"><span class="who">' + seatName(Number(k)) + '</span>' + body + '</div>';
    });
    inner.innerHTML = html;
  }

  function sortedHandView() {
    var hand = GD.sortHand(state.hand, state.level);
    if (sortMode === 'count') {
      var by = {};
      hand.forEach(function (c) { var k = GD.codeOf(c); (by[k] = by[k] || []).push(c); });
      var groups = Object.keys(by).map(Number).sort(function (a, b) {
        var d = by[b].length - by[a].length;
        if (d) return d;
        return GD.orderKey(b, state.level) - GD.orderKey(a, state.level);
      });
      var out = [];
      groups.forEach(function (k) { out = out.concat(by[k]); });
      return out;
    }
    return hand;
  }

  function renderHand() {
    if (!state || !state.hand) { $('myHand').innerHTML = ''; return; }
    var hand = sortedHandView();
    var tight = hand.length > 17;
    var hx = $('myHand');
    hx.className = 'hand' + (tight ? ' tight' : '');
    var html = '';
    for (var i = 0; i < hand.length; i++) {
      var c = hand[i];
      html += '<div class="card-wrap" data-card="' + c + '">' + cardHtml(c, state.level, false, selected.indexOf(c) >= 0) + '</div>';
    }
    hx.innerHTML = html;
  }

  function renderAction() {
    var st = $('actStatus');
    var myTurn = state && state.phase === 'playing' && state.turn === me;
    if (!state) { st.textContent = ''; }
    else if (state.phase === 'playing') st.textContent = myTurn ? (state.last ? '轮到你压牌' : '轮到你出牌') : '等待其他玩家…';
    else if (state.phase === 'tribute') st.textContent = '进贡阶段';
    else if (state.phase === 'tributeReturn') st.textContent = '还贡阶段';
    else st.textContent = '';
    $('btnPlay').disabled = !myTurn || selected.length === 0;
    $('btnPass').hidden = !(state && state.last && myTurn);
    $('btnHint').disabled = !myTurn;
    $('btnNext').hidden = !(state && (state.phase === 'handOver' || state.phase === 'matchOver') && (isHost || mode === 'ai'));
  }

  function refreshShape() { /* 牌型标签由出牌弹窗/结果承担，桌面实时提示可选 */ }

  function render() {
    if (!state) return;
    el.gameRoot.hidden = false;
    if (lobby) lobby.hide();
    renderHud(); renderSeats(); renderTrick(); renderHand(); renderAction();
    if (state.phase === 'handOver' || state.phase === 'matchOver') showResult();
    else $('gdResult').hidden = true;
    if (state.phase === 'tribute' && state.tributable && state.tributable.length) {
      openTributeModal('进贡', '交出手中最大的牌（逢人配除外）', state.tributable, 'gd_tribute');
    } else if (state.phase === 'tributeReturn' && state.returnable && state.returnable.length) {
      openTributeModal('还贡', '还一张 ≤10 的牌给对手', state.returnable, 'gd_return');
    } else {
      $('gdModal').hidden = true;
    }
  }

  function toast(msg) {
    var t = $('gdToast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 1800);
  }

  function doPlay(cards, interpId) {
    if (mode === 'ai') {
      localApply({ type: 'gd_play', cards: cards, interpId: interpId }, me);
      state = localView(); render(); localTick();
    } else if (o) o._wsSend({ type: 'gd_play', cards: cards, interpId: interpId });
    selected = [];
  }

  function onPlayClick() {
    if (!selected.length) { toast('请先选牌'); return; }
    var interps = GD.interpret(selected, state.level);
    if (!interps.length) { toast('不是合法牌型'); return; }
    if (state.last) {
      var choices = [];
      for (var i = 0; i < interps.length; i++) if (GD.beats(interps[i], state.last.shape)) choices.push(i);
      if (!choices.length) { toast('压不过上家'); return; }
      if (choices.length === 1) { doPlay(selected.slice(), choices[0]); return; }
      showInterpDialog(selected.slice(), choices, interps);
      return;
    }
    if (interps.length === 1) { doPlay(selected.slice(), 0); return; }
    var all = [];
    for (var j = 0; j < interps.length; j++) all.push(j);
    showInterpDialog(selected.slice(), all, interps);
  }

  function showInterpDialog(cards, choiceIds, interps) {
    var list = $('interpList');
    list.innerHTML = '';
    choiceIds.forEach(function (id) {
      var sh = interps[id];
      var item = document.createElement('div');
      item.className = 'interp-item';
      item.innerHTML = '<b style="color:#e8cd8b">' + (SHAPE_LABELS[sh.k] || sh.k) + '</b>' +
        '<span style="color:#b9ac8f;font-size:13px">主 ' + codeLabel(sh.key === 13 ? state.level : (sh.key + 3)) + '</span>';
      item.addEventListener('click', function () {
        $('gdInterp').hidden = true;
        doPlay(cards, id);
      });
      list.appendChild(item);
    });
    $('gdInterp').hidden = false;
  }

  function showResult() {
    var r = $('gdResult'), dlg = $('resultDialog');
    var res = state.lastResult;
    if (!res) { r.hidden = true; return; }
    var p0 = res.placements[0];
    var myWin = (p0 % 2) === (me % 2);
    var placeName = res.placements.map(function (s, i) {
      return '<div class="result-seat' + (i === 0 ? ' first' : '') + '"><b style="color:#e8cd8b">' + PLACE_LABEL[i] + '</b><span>' + seatName(s) + '</span></div>';
    }).join('');
    var title = state.phase === 'matchOver'
      ? (myWin ? '🏆 我方通关 A 级，整场获胜！' : '整场结束，对方率先通关 A 级')
      : (myWin ? '🎉 我方获胜' : '对方获胜');
    var up = res.levels[myWin ? (me % 2) : (1 - me % 2)];
    dlg.innerHTML = '<h3>' + title + '</h3><div class="result-placements">' + placeName + '</div>' +
      '<div class="hint">升到 ' + up + ' 级</div>' +
      ((isHost || mode === 'ai') && state.phase !== 'matchOver' ? '<button class="btn primary" id="btnNext2">下一局</button>' : '<button class="btn" id="btnBack2">返回大厅</button>');
    var b = $('btnNext2') || $('btnBack2');
    b.addEventListener('click', function () {
      r.hidden = true;
      if ($('btnNext2') && mode === 'ai') localNext();
      else if ($('btnNext2') && o) o._wsSend({ type: 'gd_deal' });
      else location.href = 'gd.html';
    });
    r.hidden = false;
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
        if (mode === 'ai') { localApply({ type: msgType, card: c }, me); state = localView(); render(); localTick(); }
        else if (o) o._wsSend({ type: msgType, card: c });
        $('gdModal').hidden = true;
      });
      box.appendChild(cardEl);
    });
    $('gdModal').hidden = false;
  }

  function flash(msg) { toast(msg); }

  /* ---------- 交互 ---------- */
  function bindUI() {
    $('myHand').addEventListener('click', function (e) {
      var cardEl = e.target.closest('.card');
      if (!cardEl || !cardEl.parentElement || !cardEl.parentElement.getAttribute) return;
      if (!state || state.phase !== 'playing' || state.turn !== me) return;
      var card = Number(cardEl.parentElement.getAttribute('data-card'));
      if (isNaN(card)) return;
      var idx = selected.indexOf(card);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(card);
      cardEl.classList.toggle('selected', idx < 0);
      $('btnPlay').disabled = selected.length === 0;
    });
    $('btnPlay').addEventListener('click', onPlayClick);
    $('btnPass').addEventListener('click', function () {
      if (mode === 'ai') { localApply({ type: 'gd_pass' }, me); state = localView(); render(); localTick(); }
      else if (o) o._wsSend({ type: 'gd_pass' });
      selected = [];
    });
    $('btnNext').addEventListener('click', function () {
      if (mode === 'ai') localNext();
      else if (o) o._wsSend({ type: 'gd_deal' });
      $('gdResult').hidden = true;
    });
    $('btnHint').addEventListener('click', function () {
      if (!window.GdAI) return;
      if (state.last) {
        var beat = window.GdAI.findBeat(state.hand, state.level, state.last);
        if (beat) { selected = beat.cards.slice(); renderHand(); $('btnPlay').disabled = false; return; }
        toast('要不起');
      } else {
        var sorted = GD.sortHand(state.hand, state.level);
        for (var i = sorted.length - 1; i >= 0; i--) {
          if (GD.orderKey(GD.codeOf(sorted[i]), state.level) < 13) { selected = [sorted[i]]; renderHand(); $('btnPlay').disabled = false; return; }
        }
      }
    });
    $('btnSort').addEventListener('click', function () {
      sortMode = (sortMode === 'rank') ? 'count' : 'rank';
      $('btnSort').textContent = (sortMode === 'rank') ? '按大小' : '按张数';
      renderHand();
    });
    $('btnQuit').addEventListener('click', function () {
      if (!confirm('确定要退出当前游戏吗？')) return;
      if (o) o.sendLeave();
      location.href = 'gd.html';
    });
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
      setTimeout(function () { location.href = 'gd-online.html?v=g3'; }, 1800);
    });
    online.on('giveup', function () {
      if (window.Notify) { window.Notify.clearAll(); window.Notify.show('多次重连失败，返回…', 'warn', { sticky: true }); }
      if (online) online._intentionalClose = true;
      setTimeout(function () { location.href = 'gd-online.html?v=g3'; }, 1500);
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

  /* ---------- 本地 AI 对局（无需开房，1 真人 + 3 电脑） ---------- */
  var gdGame = null;       // 引擎全量状态 { phase, match, hand }
  var localBusy = false;
  function localView() {
    var g = gdGame, h = g.hand;
    var v = {
      you: me, level: h.level, phase: g.phase,
      levels: g.match.levels.slice(), handNo: g.match.handNo,
      placements: h.placements.slice(),
      counts: h.hands.map(function (x) { return x.length; }),
      turn: (g.phase === 'playing') ? h.turn : GD.actorSeat(g),
      last: h.last ? { seat: h.last.seat, cards: h.last.cards.slice(), shape: h.last.shape } : null,
      trick: h.currentTrick.map(function (x) { return { seat: x.seat, cards: (x.cards || []).slice(), pass: !!x.pass, shape: x.shape || null }; }),
      leader: h.leader,
      matchWinner: (g.phase === 'matchOver') ? g.match.winner : null
    };
    v.hand = (h.hands[me] || []).slice();
    if (h.tribute) {
      v.tribute = {
        kind: h.tribute.kind, resisted: !!h.tribute.resisted,
        pairs: h.tribute.pairs.map(function (x) { return { from: x.from, to: x.to, done: x.card !== null, returned: x.returned !== null }; })
      };
    }
    if (g.phase === 'tribute') v.tributable = GD.tributableCards(g, me);
    if (g.phase === 'tributeReturn') v.returnable = GD.returnableCards(g, me);
    if ((g.phase === 'handOver' || g.phase === 'matchOver') && g.match.prevPlacements) {
      v.lastResult = { placements: g.match.prevPlacements.slice(), levels: g.match.levels.slice(), winner: g.match.winner };
    }
    return v;
  }
  function startLocal() {
    mode = 'ai';
    if (typeof GD === 'undefined' || !window.GdAI) {
      if (window.Notify) window.Notify.show('引擎加载失败，请刷新重试', 'error', { sticky: true });
      return;
    }
    var r = GD.beginHand(GD.createMatch(), Math.random);
    gdGame = { phase: r.phase, match: r.match, hand: r.hand };
    me = 0;
    names = ['你', 'AI·2', 'AI·3', 'AI·4'];
    roomStarted = true;
    isHost = false;
    el.gameRoot.hidden = false;
    state = localView();
    render();
    localTick();
  }
  function localApply(act, seat) {
    var r = null;
    if (act.type === 'gd_play') r = GD.applyPlay(gdGame, seat, act.cards, act.interpId);
    else if (act.type === 'gd_pass') r = GD.applyPass(gdGame, seat);
    else if (act.type === 'gd_tribute') r = GD.applyTribute(gdGame, seat, act.card);
    else if (act.type === 'gd_return') r = GD.applyReturn(gdGame, seat, act.card);
    if (r && r.ok) gdGame = Object.assign(gdGame, r.state);
    return r;
  }
  function localNext() {
    if (!gdGame) return;
    if (gdGame.phase === 'matchOver') gdGame = { phase: 'idle', match: GD.createMatch(), hand: null };
    var r = GD.beginHand(gdGame.match, Math.random);
    gdGame = { phase: r.phase, match: r.match, hand: r.hand };
    state = localView();
    render();
    localTick();
  }
  function localTick() {
    if (!gdGame) return;
    if (gdGame.phase === 'handOver' || gdGame.phase === 'matchOver') { state = localView(); render(); return; }
    var seat = GD.actorSeat(gdGame);
    if (seat === me) { state = localView(); render(); return; }
    if (localBusy) return;
    localBusy = true;
    setTimeout(function () {
      localBusy = false;
      if (!gdGame || gdGame.phase === 'handOver' || gdGame.phase === 'matchOver') return;
      var s2 = GD.actorSeat(gdGame);
      if (s2 === me) { state = localView(); render(); return; }
      var act = window.GdAI.decide(state, s2, gdGame.hand.hands[s2]);
      if (act) { localApply(act, s2); state = localView(); render(); }
      localTick();
    }, 700 + Math.random() * 900);
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

    if (q.mode === 'ai') { startLocal(); return; }
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
