/* 优诺UNO！（UNO）游戏前端：统一等待室(GameLobby)→开始→对局
 *  URL 驱动开局(mode=online&room&role&gm)、渲染裁剪视图、出牌/摸牌/选色交互
 */
(function () {
  'use strict';

  var q = {};
  location.search.replace(/[?&]([^=]+)=([^&]*)/g, function (_, k, v) { q[k] = decodeURIComponent(v); });

  var MODE_LABEL = { 'ffa': '单人混战', '2v2': '双人组队' };
  var COLOR_NAMES = { r: '红', b: '蓝', g: '绿', y: '黄' };
  var KIND_LABEL = { s: '跳过', r: '反转', d: '+2', w: '万色', w4: '万色+4' };

  var o = null;                    // UnoOnline
  var me = -1;
  var names = null;   // 联机房间各槽位昵称（lobby.names）                     // 我的座次
  var isHost = false;
  var state = null;                // 最近一次裁剪视图
  var roomStarted = false;
  var lobby = null;                // GameLobby 实例
  var mode = q.gm || 'ffa';
  var currentRoom = q.room || '';

  /* ---------- 回合倒计时（10 秒时限） + 整局 4 分钟 ---------- */
  var TURN_SECONDS = 10;               // 每位玩家出牌时限
  var GAME_SECONDS = 240;              // 每局总时长 4 分钟
  var timerLeft = TURN_SECONDS;
  var lastTurn = -1;
  var gameSeconds = GAME_SECONDS;
  var gameOverNotified = false;
  function renderTimer() {
    if (!el.turnTimer) return;
    var mm = String(Math.floor(Math.max(0, timerLeft) / 60)).padStart(2, '0');
    var ss = String(Math.max(0, timerLeft) % 60).padStart(2, '0');
    el.turnTimer.textContent = mm + ':' + ss;
    el.turnTimer.classList.toggle('low', timerLeft <= 3);
  }
  function renderGameClock() {
    if (el.gameTimer) el.gameTimer.textContent = String(Math.floor(Math.max(0, gameSeconds) / 60)).padStart(2, '0') + ':' + String(Math.max(0, gameSeconds) % 60).padStart(2, '0');
  }
  // 出牌超 10 秒 → 复用 AI 决策自动出招（出牌/摸牌/过/选色）
  function autoPlayOnTimeout() {
    if (!state || me !== state.turn || state.winner >= 0) return;
    if (!window.UnoAI) return;
    var acts;
    try { acts = window.UnoAI.choose(state, me, state.hand || []); } catch (e) { return; }
    if (!acts) return;
    var arr = Array.isArray(acts) ? acts : [acts];
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (a.type === 'play' && o && o.sendPlay) o.sendPlay(a.card);
      else if (a.type === 'draw' && o && o.sendDraw) o.sendDraw();
      else if (a.type === 'pass' && o && o.sendPass) o.sendPass();
      else if (a.type === 'setColor' && o && o.sendSetColor) o.sendSetColor(a.color);
    }
    if (window.Notify) window.Notify.show('⏱ 出牌超时，已自动出牌', 'warn');
  }
  function renderDir() {
    if (el.dirArrow) el.dirArrow.classList.toggle('rev', !!(state && state.dir < 0));
  }

  var el = {};
  function $(id) { return document.getElementById(id); }

  /* ---------- 人机模式：房主自动补 AI 到 3 人 ---------- */
  var aiFilled = 0;
  function autoFillAI(d) {
    if (q.ai !== '1') return;                                    // 仅人机模式
    if (mode !== 'ffa' || !isHost || !d || d.started) return;   // 仅单人混战房主
    if (aiFilled >= 5) return;                                   // 防循环
    var players = d.players || [];
    var total = 0, i;
    for (i = 0; i < players.length; i++) if (players[i]) total++;   // 真人 + AI 已占位总数
    if (total >= 3) return;                                      // 满 3 人（含 AI）即停
    for (i = 0; i < players.length; i++) {
      if (!players[i]) {
        aiFilled++;
        if (o) { if (o._wsSend) o._wsSend({ type: 'add_ai', slot: i }); else o.send({ type: 'add_ai', slot: i }); }
        return;
      }
    }
  }

  /* ---------- 卡牌素材映射：引擎 id → 文件名 ---------- */
  function cardImg(id) {
    if (id === 'w') return 'cards/WC.png';
    if (id === 'w4') return 'cards/W4.png';
    var c = id.charAt(0), rest = id.slice(1);
    var file = { s: 'S', r: 'R', d: 'A2' }[rest] || rest.toUpperCase();
    return 'cards/' + c.toUpperCase() + file + '.png';
  }

  /* ---------- 横屏强制 ---------- */
  function checkOrientation() {
    var landscape = window.innerWidth >= window.innerHeight;
    el.landscapeOverlay.hidden = landscape;
  }

  /* ---------- 规则辅助（本地预检，服务端仍权威） ---------- */
  function kindOf(c) { if (c === 'w' || c === 'w4') return 'w'; return c.charAt(0); }
  function kindOk(c, top, color) {
    if (kindOf(c) === 'w') return true;
    if (kindOf(top) === 'w') return c.charAt(0) === color;
    return c.charAt(0) === color || c.charAt(1) === top.charAt(1);
  }
  // 万色+4 官方严格：手里有「与顶牌同色」的牌就禁止出
  function w4RuleOk(c, hand, color) {
    if (c !== 'w4') return true;
    return !hand.some(function (x) { var k = kindOf(x); return k !== 'w' && x.charAt(0) === color; });
  }
  function playableCards() {
    if (!state || state.awaitColor || me !== state.turn || state.winner >= 0) return [];
    var out = [];
    var h = state.hand || [];
    // 被 +2/+4 罚时：只能出 +2 / 万色+4 叠加
    if (state.nextDraw > 0) {
      for (var m = 0; m < h.length; m++) {
        var mc = h[m];
        var mk = kindOf(mc);
        if (mk === 'd' && kindOk(mc, state.top, state.topColor)) out.push(mc);
        else if (mk === 'w4') out.push(mc);
      }
      return out;
    }
    for (var i = 0; i < h.length; i++) {
      var c = h[i];
      // 官方规则：主动摸牌后只能出刚摸的那张（或过），不能再出原有牌
      if (state.justDrew && c !== state.lastDrawn) continue;
      if (kindOk(c, state.top, state.topColor)) out.push(c);   // w4 随时可出（kindOk 恒 true）
    }
    return out;
  }
  function canDrawNow() {
    if (!state || state.winner >= 0 || me !== state.turn || state.awaitColor) return false;
    if (state.justDrew) return false;   // 主动摸 1 后只能出或过
    return true;
  }
  function passAllowed() { return !!state && !state.awaitColor && me === state.turn && state.justDrew && state.nextDraw === 0 && state.winner < 0; }
  function capacityOf() {
    if (mode === '2v2') return 4;      // 组队：固定 4
    if (mode === 'ffa') return 4;      // 单人混战：可坐 4 人，≥3 人即开局（3/4 人局）
    var n = parseInt(mode, 10);
    return (n >= 2 && n <= 4) ? n : 2;
  }
  function teamOf(s) { return state && state.teams ? state.teams[s] : 0; }
  function teamOfMe() { return teamOf(me); }

  /* ---------- 渲染：四周玩家（上 / 左 / 右，围桌） ---------- */
  function seatSpots() {
    var cap = state ? (state.capacity || capacityOf()) : capacityOf();
    var spots = [];
    for (var s = 0; s < Math.min(cap, 4); s++) if (s !== me) spots.push(s);
    var posMap = ['top', 'left', 'right'];
    var out = [];
    for (var i = 0; i < spots.length; i++) out.push({ seat: spots[i], pos: posMap[i % 3] });
    return out;
  }
  function renderOpps() {
    var top = '', left = '', right = '';
    seatSpots().forEach(function (it) {
      var card = oppCard(it.seat);
      if (it.pos === 'top') top += card;
      else if (it.pos === 'left') left += card;
      else right += card;
    });
    el.playerTop.innerHTML = top;
    el.playerLeft.innerHTML = left;
    el.playerRight.innerHTML = right;
  }
  function oppCard(s) {
    var cnt = state ? state.counts[s] : 0;
    var isTurn = state && state.turn === s;
    var uno = state && state.uno && state.uno[s];
    var name = (names && names[s]) ? names[s] : ('玩家 ' + (s + 1));
    var teamCls = '';
    if (mode === '2v2' && state && state.teams) teamCls = state.teams[s] === state.teams[me] ? ' ta' : ' tb';
    var backs = '';
    var n = Math.min(cnt, 12);
    for (var i = 0; i < n; i++) backs += '<div class="uo-back"></div>';
    var cntBadge = cnt > 12 ? '<span class="uo-p-cnt">' + cnt + '</span>' : '';
    return '<div class="uo-p-card' + (isTurn ? ' turn' : '') + '">' +
      '<div class="uo-p-avatar">👤</div>' +
      '<div class="uo-p-name' + teamCls + '">' + name + (uno ? '<span class="uo-p-uno">UNO!</span>' : '') + '</div>' +
      (isTurn ? '<span class="uo-p-turn-tag">◆ 出牌中</span>' : '') +
      '<div class="uo-p-hand">' + backs + cntBadge + '</div>' +
      '</div>';
  }

  /* ---------- 渲染：中央区 ---------- */
  function renderBoard() {
    if (!state) return;
    if (state.top) {
      var newSrc = cardImg(state.top);
      var srcChanged = el.topCardImg.getAttribute('src') !== newSrc;
      el.topCardImg.setAttribute('src', newSrc);
      el.topCardImg.style.display = '';
      // 中央牌每次变化重新触发 pop 动画（img.src 变化不会自动重播 CSS 动画）
      if (srcChanged) {
        el.topCardImg.style.animation = 'none';
        void el.topCardImg.offsetWidth;
        el.topCardImg.style.animation = '';
      }
    } else {
      el.topCardImg.style.display = 'none';
    }
    var dot = el.colorDot;
    if (state.topColor && COLOR_NAMES[state.topColor]) {
      dot.style.background = colorCss(state.topColor);
      dot.style.boxShadow = '0 0 18px ' + colorCss(state.topColor) + 'aa';
      dot.textContent = colorLabel(state.topColor);
    } else {
      dot.textContent = '';
      dot.style.background = 'transparent';
      dot.style.boxShadow = 'none';
    }
    renderBanner();
    var myDraw = canDrawNow();
    el.btnDraw.disabled = !myDraw;
    el.btnDraw.classList.toggle('on', myDraw);
    el.deckInner.textContent = (state.nextDraw > 0 ? '摸 ' + state.nextDraw + ' 张' : '摸牌');
    // 质疑 +4：被加人轮到且未操作时显示
    var canChallenge = !!(state.challenge && state.nextDraw > 0 && me === state.turn);
    if (el.btnChallenge) {
      el.btnChallenge.hidden = !canChallenge;
      el.btnDraw.classList.toggle('with-challenge', canChallenge);
    }
    el.btnPass.hidden = !passAllowed();
  }
  function colorCss(c) { return { r: '#e5484d', b: '#3e8ef7', g: '#2ebd59', y: '#f5c542' }[c] || '#888'; }
  function colorLabel(c) { return { r: '红', b: '蓝', g: '绿', y: '黄' }[c] || ''; }

  /* 横幅：谁出牌/效果/轮到谁 */
  function renderBanner() {
    if (!state) return;
    var b = el.banner;
    var msg = '';
    var cls = '';
    if (state.winner >= 0) {
      msg = winnerText();
      cls = ' win';
    } else if (state.nextDraw > 0) {
      msg = ((names && names[state.turn]) ? names[state.turn] : ('玩家 ' + (state.turn + 1))) + ' 需摸 ' + state.nextDraw + ' 张';
      cls = ' warn';
    } else if (state.awaitColor) {
      msg = '等待 ' + ((names && names[state.turn]) ? names[state.turn] : ('玩家 ' + (state.turn + 1))) + ' 选色';
      cls = ' warn';
    } else if (me === state.turn) {
      msg = '轮到你出牌' + (state.justDrew ? '（摸牌后可出刚摸的牌或点「过」）' : '');
      cls = ' mine';
    } else {
      msg = '轮到玩家 ' + (state.turn + 1) + (state.dir < 0 ? '（逆向）' : '');
      cls = '';
    }
    b.textContent = msg;
    b.className = 'uo-banner' + cls;
  }

  /* ---------- 渲染：自己手牌 + 队友 ---------- */
  function renderMe() {
    if (!state) return;
    var playable = playableCards();
    var playableSet = {};
    playable.forEach(function (c) { playableSet[c] = true; });
    var h = state.hand || [];
    var html = '';
    for (var i = 0; i < h.length; i++) {
      var c = h[i];
      var p = !!playableSet[c];
      html += '<div class="uc-wrap' + (p ? ' ok' : ' no') + '" data-card="' + c + '" data-idx="' + i + '">' +
        '<img class="uc uc-hand' + (p ? ' glow' : '') + '" src="' + cardImg(c) + '" alt="' + cardAlt(c) + '"></div>';
    }
    el.myHand.innerHTML = html;
    if (h.length === 0) el.myHand.innerHTML = '<div class="uo-empty">已出完</div>';

    if (state.mate != null && state.mateHand) {
      el.mateLabel.textContent = '队友（玩家 ' + (state.mate + 1) + '）';
      var mh = '';
      for (var j = 0; j < state.mateHand.length; j++) {
        mh += '<img class="uc uc-hand ucmate" src="' + cardImg(state.mateHand[j]) + '" alt="' + cardAlt(state.mateHand[j]) + '">';
      }
      el.mateHand.innerHTML = mh;
      el.mateRow.hidden = false;
    } else {
      el.mateRow.hidden = true;
    }

    el.btnUno.hidden = !(h.length === 1 && state.winner < 0);
    var meTurn = me === state.turn && state.awaitColor === false && state.nextDraw === 0 && state.winner < 0;
    el.myHand.classList.toggle('act', meTurn);
  }
  function cardAlt(c) {
    var k = kindOf(c);
    if (k === 'w') return '万色';
    var color = COLOR_NAMES[c.charAt(0)];
    var kk = c.charAt(1);
    var label = KIND_LABEL[kk] || kk;
    return color + label;
  }

  /* ---------- 结果横幅 ---------- */
  function winnerText() {
    var w = state.winner;
    if (mode === '2v2') {
      var myTeam = teamOfMe();
      return w === myTeam ? '🎉 你的队伍获胜！' : '😔 对方队伍获胜';
    }
    return w === me ? '🎉 恭喜你胜利了！' : ('😔 ' + ((names && names[w]) ? names[w] : ('玩家 ' + (w + 1))) + ' 获胜');
  }
  function showResult() {
    var r = el.resultBanner;
    r.textContent = winnerText();
    r.className = 'uo-result show' + ((mode !== '2v2' && state.winner === me) ? ' big' : '');
    r.hidden = false;
    if (window.Notify) {
      window.Notify.show(winnerText(), state.winner === (mode === '2v2' ? teamOfMe() : me) ? 'win' : 'lose', { sticky: true });
    }
    if (isHost || mode === 'ai') {
      setTimeout(function () {
        var again = document.createElement('button');
        again.className = 'btn on uo-again';
        again.textContent = '再来一局 →';
        again.addEventListener('click', function () {
          if (mode === 'ai') startLocalAI();
          else if (o) o.sendReset();
        });
        r.appendChild(again);
      }, 800);
    }
  }

  /* ---------- 交互 ---------- */
  var flyBusy = false;   // 出牌动画进行中（防连点）
  var drag = null;       // 拖拽状态 {wrap,card,x,y,moved}
  function onHandDown(e) {
    var wrap = e.target.closest('.uc-wrap');
    if (!wrap) return;
    if (!el.myHand.classList.contains('act')) return;
    var card = wrap.getAttribute('data-card');
    if (!card) return;
    drag = { wrap: wrap, card: card, x: e.clientX, y: e.clientY, moved: false };
    wrap.classList.add('dragging');
    e.preventDefault();
  }
  function onHandMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved) drag.wrap.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(7deg)';
  }
  function onHandUp(e) {
    if (!drag) return;
    var wrap = drag.wrap, card = drag.card;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var wasDrag = drag.moved && dist > 55;
    drag = null;
    wrap.classList.remove('dragging');
    wrap.style.transform = '';
    // 点击或拖出桌面 → 都算打出（带飞行动画）
    tryPlay(card, wrap, wasDrag);
  }
  // 牌从手牌飞向中央出牌区（带防御：wrap 脱离 DOM / animate 异常时直接跳过动画）
  function flyCard(wrap, card, done) {
    var safe = function () { if (done) { try { done(); } catch (e) {} } };
    if (!wrap || !document.body.contains(wrap)) { safe(); return; }
    flyFromRect(wrap.getBoundingClientRect(), card, safe);
  }
  // 通用：从任意矩形中心飞一张牌到中央出牌区（对手出牌动画也复用）
  function flyFromRect(fromRect, card, done) {
    var target = el.topCardImg;
    var safe = function () { if (done) { try { done(); } catch (e) {} } };
    if (!target || !fromRect) { safe(); return; }
    var to = target.getBoundingClientRect();
    var fly = document.createElement('img');
    fly.src = cardImg(card);
    fly.className = 'uc';
    fly.style.cssText = 'position:fixed;z-index:9998;pointer-events:none;margin:0;will-change:transform;';
    fly.style.left = (fromRect.left + fromRect.width / 2 - 21) + 'px';
    fly.style.top = (fromRect.top + fromRect.height / 2 - 29) + 'px';
    fly.style.width = '42px';
    document.body.appendChild(fly);
    var sx = fromRect.left + fromRect.width / 2;
    var sy = fromRect.top + fromRect.height / 2;
    var dx = to.left + to.width / 2 - sx;
    var dy = to.top + to.height / 2 - sy;
    var finished = false;
    var finish = function () { if (finished) return; finished = true; try { fly.remove(); } catch (e) {} safe(); };
    if (typeof fly.animate === 'function') {
      try {
        fly.animate([
          { transform: 'translate(0,0) rotate(0) scale(0.8)', opacity: 0.9 },
          { transform: 'translate(' + (dx * 0.5) + 'px,' + (dy - 60) + 'px) rotate(8deg) scale(1)', opacity: 1, offset: 0.55 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(0deg) scale(0.5)', opacity: 0.9 }
        ], { duration: 420, easing: 'cubic-bezier(0.35, 0.9, 0.4, 1)' }).onfinish = finish;
        setTimeout(finish, 800);   // 兜底
        return;
      } catch (e) { /* 降级 */ }
    }
    fly.remove();
    safe();
  }
  // 对手/AI 出牌动画：从出牌者方向飞一张牌到中央（增加整体动画感）
  function oppFlyIn(slot) {
    if (slot === me) return;
    var holder = null;
    seatSpots().forEach(function (it) { if (it.seat === slot) holder = el['player' + (it.pos.charAt(0).toUpperCase() + it.pos.slice(1))]; });
    if (!holder || !holder.firstChild || !state || !state.top) return;
    flyFromRect(holder.firstChild.getBoundingClientRect(), state.top, null);
  }
  function bindUI() {
    el.myHand.addEventListener('pointerdown', onHandDown);
    window.addEventListener('pointermove', onHandMove);
    window.addEventListener('pointerup', onHandUp);
    window.addEventListener('pointercancel', onHandUp);
    el.btnDraw.addEventListener('click', function () {
      if (!canDrawNow()) return;
      if (mode === 'ai') localStep(function (s) { Uno.draw(s, me); });
      else if (o) o.sendDraw();
    });
    if (el.btnChallenge) el.btnChallenge.addEventListener('click', function () {
      if (!(state && state.challenge && state.nextDraw > 0 && me === state.turn)) return;
      if (o && o.sendChallenge) o.sendChallenge();
      el.btnChallenge.hidden = true;
    });
    el.btnPass.addEventListener('click', function () {
      if (!passAllowed()) return;
      if (mode === 'ai') localStep(function (s) { Uno.pass(s, me); });
      else if (o) o.sendPass();
    });
    el.btnUno.addEventListener('click', function () {
      if (mode === 'ai') { Uno.callUno(localState, me); renderMe(); }
      else if (o) o.sendCallUno();
      el.btnUno.hidden = true;
    });
    el.colorModal.addEventListener('click', function (e) {
      var b = e.target.closest('.cp');
      if (!b) return;
      var color = b.getAttribute('data-c');
      if (mode === 'ai') { Uno.setColor(localState, me, color); applyLocalView(); maybeLocalAI(); }
      else if (o) o.sendSetColor(color);
      el.colorModal.hidden = true;
    });
    // 左下快捷功能区（占位交互）
    function quickMsg(ico, txt) { return function () { if (window.Notify) window.Notify.show(ico + ' ' + txt, 'info'); }; }
    if (el.btnEmoji) el.btnEmoji.addEventListener('click', quickMsg('😊', '表情功能开发中'));
    if (el.btnChat) el.btnChat.addEventListener('click', quickMsg('💬', '对话功能开发中'));
    if (el.btnVoice) el.btnVoice.addEventListener('click', quickMsg('🎤', '语音功能开发中'));
  }

  function tryPlay(card, wrap, dragged) {
    if (!state || me !== state.turn || state.winner >= 0) return;
    if (state.awaitColor) return;
    var hand = state.hand || [];
    if (hand.indexOf(card) < 0) return;
    var k = kindOf(card);
    if (state.nextDraw > 0) {
      // 叠加：只允许出 +2（需可打）或 万色+4
      if (k !== 'd' && k !== 'w4') return;
      if (k === 'd' && !kindOk(card, state.top, state.topColor)) { flash('这张牌不能出'); return; }
    } else {
      if (!kindOk(card, state.top, state.topColor)) { flash('这张牌不能出'); return; }
    }
    if (flyBusy) return;
    flyBusy = true;
    flyCard(wrap, card, function () {
      if (mode === 'ai') localPlay(card);
      else if (o) o.sendPlay(card);
      // 出剩 1 张自动喊 UNO（4 秒宽容窗口内免罚）
      if (mode !== 'ai' && hand.length === 2) setTimeout(function () { if (o) o.sendCallUno(); }, 120);
      flyBusy = false;
    });
  }

  function flash(msg) {
    el.banner.textContent = msg;
    el.banner.className = 'uo-banner warn shake';
    setTimeout(function () { if (el.banner.className.indexOf('shake') >= 0) el.banner.className = 'uo-banner'; }, 900);
  }

  /* ---------- 本地 AI 对局（无需开房，1 真人 + 2 电脑） ---------- */
  var localState = null;
  var localAI_busy = false;
  function toLocalView(s) {
    return {
      you: me, mode: 'ai', capacity: s.capacity, top: s.top, topColor: s.topColor,
      turn: s.turn, dir: s.dir, nextDraw: s.nextDraw, awaitColor: s.awaitColor,
      justDrew: s.justDrew, lastDrawn: s.lastDrawn, uno: s.uno, winner: s.winner,
      hand: s.hands[me].slice(), counts: s.hands.map(function (h) { return h.length; }),
      teams: s.teams, mate: null, mateHand: null, challenge: false
    };
  }
  function startLocalAI() {
    mode = 'ai';
    if (typeof Uno === 'undefined' || !window.UnoAI) {
      if (window.Notify) window.Notify.show('引擎加载失败，请刷新重试', 'error', { sticky: true });
      return;
    }
    localState = Uno.createState('3');
    Uno.deal(localState);
    me = 0;
    names = ['你', 'AI·2', 'AI·3'];
    roomStarted = true;
    isHost = false;
    if (el.unoGameTitle) el.unoGameTitle.style.display = 'none';
    el.gameRoot.hidden = false;
    lastTurn = -1;
    applyLocalView();
    maybeLocalAI();
  }
  function applyLocalView() {
    state = toLocalView(localState);
    renderOpps(); renderBoard(); renderMe();
    if (localState.winner >= 0) showResult();
    else if (el.resultBanner) el.resultBanner.hidden = true;
  }
  function localStep(fn) {
    fn(localState);
    applyLocalView();
    maybeLocalAI();
  }
  function maybeLocalAI() {
    if (!localState || localState.winner >= 0) return;
    if (localState.turn === me) return;
    if (localAI_busy) return;
    localAI_busy = true;
    setTimeout(function () {
      localAI_busy = false;
      if (!localState || localState.winner >= 0) return;
      if (localState.turn === me) return;
      var s = localState.turn;
      var hand = localState.hands[s];
      var acts = window.UnoAI.choose(localState, s, hand);
      if (!acts) return;
      (Array.isArray(acts) ? acts : [acts]).forEach(function (a) {
        if (a.type === 'play') Uno.play(localState, s, a.card);
        else if (a.type === 'draw') Uno.draw(localState, s);
        else if (a.type === 'pass') Uno.pass(localState, s);
        else if (a.type === 'setColor') Uno.setColor(localState, s, a.color);
        else if (a.type === 'callUno') Uno.callUno(localState, s);
      });
      applyLocalView();
      maybeLocalAI();
    }, 700 + Math.random() * 900);
  }
  function localPlay(card) {
    Uno.play(localState, me, card);
    if (localState.hands[me].length === 1) Uno.callUno(localState, me);
    applyLocalView();
    maybeLocalAI();
  }

  /* ---------- 状态接收 ---------- */
  function applyState(s) {
    var prevTurn = state ? state.turn : -1;   // 上一局面的 turn ≈ 上一手出牌者
    var topChanged = !state || state.top !== s.top;
    state = s;
    if (s.you != null) me = s.you;
    roomStarted = true;
    // 开局后隐藏顶部标题「优诺UNO！」（进游戏不再显示游戏名）
    if (el.unoGameTitle) el.unoGameTitle.style.display = 'none';
    // 对手/AI 出牌：从出牌者方向飞一张牌到中央（自身出牌由 flyCard 处理，不重复播）
    if (topChanged && s.top && prevTurn >= 0 && prevTurn !== me) oppFlyIn(prevTurn);
    // 回合切换 → 重置 10 秒出牌计时（仅自己回合倒计时）
    if (s.turn !== lastTurn) { lastTurn = s.turn; timerLeft = (me === s.turn) ? TURN_SECONDS : 0; renderTimer(); }
    renderDir();
    if (s.winner >= 0) showResult();
    else if (el.resultBanner) el.resultBanner.hidden = true;
    el.gameRoot.hidden = false;
    if (lobby) lobby.hide();
    renderOpps();
    renderBoard();
    renderMe();
    if (me === s.turn && s.awaitColor && s.winner < 0) {
      el.colorModal.hidden = false;
    }
  }

  /* ---------- 联机绑定 ---------- */
  function bindOnline(online) {
    // 连接状态 → 通知栏（与其他游戏一致）
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
      names = (d.names && d.names.length) ? d.names : null;   // 各槽位昵称（胜负横幅/摸牌提示用）
      var fromGame = roomStarted;
      roomStarted = !!d.started;
      if (lobby) {
        if (d.started) { window.Notify.clear('🔔 房主提醒你准备'); lobby.hide(); }
        else {
          // 对局结束回房（对手退出/掉线）
          if (fromGame && state) {
            state = null;
            window.Notify.clearAll();
            window.Notify.show('对局已结束（对方退出/掉线），返回房间', 'warn', { sticky: true });
          }
          lobby.show(currentRoom);
          lobby.render(d);
          autoFillAI(d);   // 人机模式：房主自动补 AI 到 3 人
        }
      }
    });
    online.on('started', function () { roomStarted = true; if (lobby) lobby.hide(); });
    online.on('state', function (s) { applyState(s); });
    online.on('players', function () { if (roomStarted && state) renderOpps(); });
    online.on('notify', function () { if (window.Notify) window.Notify.show('🔔 房主提醒你准备', 'warn', { sticky: true }); });
    online.on('error', function (msg) { if (msg) flash(msg); });
    online.on('dissolve', function () {
      roomStarted = false;
      if (online) online._intentionalClose = true;
      if (lobby) lobby.hide();
      if (window.Notify) {
        window.Notify.clearAll();
        window.Notify.show('房间已解散（有玩家离开），即将返回大厅…', 'error', { sticky: true });
      }
      setTimeout(function () { location.href = 'uno-online.html?mode=' + encodeURIComponent(mode) + '&v=u2'; }, 1800);
    });
    online.on('giveup', function () {
      if (window.Notify) {
        window.Notify.clearAll();
        window.Notify.show('多次重连失败，返回房间…', 'warn', { sticky: true });
      }
      if (online) online._intentionalClose = true;
      setTimeout(function () { location.href = 'uno-online.html?mode=' + encodeURIComponent(mode) + '&v=u2'; }, 1500);
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    ['landscapeOverlay', 'gameRoot', 'gameView', 'playerTop', 'playerLeft', 'playerRight',
     'topCardImg', 'colorDot', 'btnDraw', 'deckInner', 'dirRing', 'dirArrow', 'turnTimer',
     'banner', 'meLabel', 'meAvatar', 'btnUno', 'btnPass', 'myHand', 'mateRow', 'mateLabel', 'mateHand',
     'btnEmoji', 'btnChat', 'btnVoice', 'gameTimer', 'unoGameTitle', 'btnChallenge',
     'colorModal', 'resultBanner', 'roomCodeTag'].forEach(function (id) { el[id] = $(id); });
    renderGameClock();

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', function () { setTimeout(checkOrientation, 120); });
    bindUI();
    // 回合倒计时每秒递减 + 整局时钟
    setInterval(function () {
      if (!state || state.winner >= 0 || me < 0) return;
      if (me === state.turn && timerLeft > 0) {
        timerLeft--;
        if (timerLeft <= 0) autoPlayOnTimeout();   // 10 秒时限到 → 自动出招
        renderTimer();
      }
      if (gameSeconds > 0) {
        gameSeconds--;
        renderGameClock();
        if (gameSeconds <= 0 && !gameOverNotified) {
          gameOverNotified = true;
          if (window.Notify) window.Notify.show('⏱ 整局时间到，按手牌最少者结算…', 'warn');
        }
      }
    }, 1000);

    if (q.mode === 'ai') { startLocalAI(); return; }
    if (q.mode !== 'online' || !q.room) {
      // 非联机（本地/AI 暂未开放）→ 提示返回
      if (window.Notify) window.Notify.show('优诺UNO！目前仅支持互联网对战（双人/三人/四人/2v2）', 'error', { sticky: true });
      setTimeout(function () { location.href = 'uno.html'; }, 1800);
      return;
    }

    currentRoom = q.room;
    isHost = q.role === 'host';   // 修复：此前 isHost 从未赋值（再来一局按钮失效）
    if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + currentRoom; el.roomCodeTag.hidden = false; }

    o = new window.UnoOnline();
    o.code = currentRoom;
    // AI 思考延迟：0.7~1.6 秒随机（更像真人出牌节奏）
    if (window.BotDriver) BotDriver.attach(o, { game: 'uno', delay: function () { return 700 + Math.random() * 900; } });

    // 统一等待室（与四款游戏同构）
    lobby = new window.GameLobby({
      onReady: function () { if (o) o.sendReady(); },
      onStart: function () { if (o) o.sendStart(); },
      onNotify: function () { if (o) o.sendNotify(); if (window.Notify) window.Notify.show('已提醒对方准备', 'info'); },
      onLeave: function () { if (o) o.sendLeave(); location.href = 'uno.html'; },
      onAddAI: function (i) { if (o) { if (o._wsSend) o._wsSend({ type: 'add_ai', slot: i }); else o.send({ type: 'add_ai', slot: i }); } },
      onRemoveAI: function (i) { if (o) { if (o._wsSend) o._wsSend({ type: 'remove_ai', slot: i }); else o.send({ type: 'remove_ai', slot: i }); } },
      shareExtra: '&gm=' + encodeURIComponent(mode)
    });
    lobby.setCapacity(capacityOf());
    if (mode === 'ffa') lobby.setMinToStart(3);   // 单人混战：满 3 人开局（3/4 人局）
    if (mode === '2v2') lobby.setSeatTags(['下排', '下排', '上排', '上排']);   // 2v2 必须满 4
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