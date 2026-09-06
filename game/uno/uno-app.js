/* 匹配卡牌（UNO）游戏前端：统一等待室(GameLobby)→开始→对局
 *  URL 驱动开局(mode=online&room&role&gm)、渲染裁剪视图、出牌/摸牌/选色交互
 */
(function () {
  'use strict';

  var q = {};
  location.search.replace(/[?&]([^=]+)=([^&]*)/g, function (_, k, v) { q[k] = decodeURIComponent(v); });

  var MODE_LABEL = { '2': '双人', '3': '三人', '4': '四人', '2v2': '2v2 组队' };
  var COLOR_NAMES = { r: '红', b: '蓝', g: '绿', y: '黄' };
  var KIND_LABEL = { s: '跳过', r: '反转', d: '+2', w: '万色', w4: '万色+4' };

  var o = null;                    // UnoOnline
  var me = -1;                     // 我的座次
  var isHost = false;
  var state = null;                // 最近一次裁剪视图
  var roomStarted = false;
  var lobby = null;                // GameLobby 实例
  var mode = q.gm || '2';
  var currentRoom = q.room || '';

  var el = {};
  function $(id) { return document.getElementById(id); }

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
    if (!state || state.awaitColor || state.nextDraw > 0 || me !== state.turn || state.winner >= 0) return [];
    var out = [];
    var h = state.hand || [];
    for (var i = 0; i < h.length; i++) {
      var c = h[i];
      if (kindOk(c, state.top, state.topColor) && w4RuleOk(c, h, state.topColor)) out.push(c);
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
    if (mode === '2v2') return 4;
    var n = parseInt(mode, 10);
    return (n === 3 || n === 4) ? n : 2;
  }
  function teamOf(s) { return state && state.teams ? state.teams[s] : 0; }
  function teamOfMe() { return teamOf(me); }

  /* ---------- 渲染：对手条 ---------- */
  function opponentsList() {
    var list = [];
    var cap = state ? (state.capacity || 4) : 4;
    for (var s = 0; s < cap; s++) {
      if (s === me) continue;
      if (state && state.mate != null && s === state.mate) continue;   // 队友放底部
      list.push(s);
    }
    return list;
  }
  function renderOpps() {
    var opps = opponentsList();
    var html = '';
    for (var i = 0; i < opps.length; i++) {
      var s = opps[i];
      if (s >= 4) continue;
      html += oppCard(s, mode === '2v2');
    }
    el.oppRow.innerHTML = html;
  }
  function oppCard(s, isTeamMode) {
    var cnt = state ? state.counts[s] : 0;
    var isTurn = state && state.turn === s;
    var uno = state && state.uno && state.uno[s];
    var teamTag = '';
    if (isTeamMode && state && state.teams) {
      var sameTeam = state.teams[s] === state.teams[me];
      teamTag = '<span class="uo-opp-team ' + (sameTeam ? 'ta' : 'tb') + '">' + (sameTeam ? '我方' : '敌方') + '</span>';
    }
    return '<div class="uocard-opp' + (isTurn ? ' turn' : '') + '">' +
      '<div class="uo-opp-top"><span class="uo-opp-name">玩家 ' + (s + 1) + '</span>' +
      teamTag +
      (uno ? '<span class="uo-opp-uno">UNO!</span>' : '') + '</div>' +
      '<div class="uo-opp-body"><div class="uo-back">UNO</div><span class="uo-opp-cnt">' + cnt + '</span></div>' +
      '<div class="uo-opp-foot">' + (isTurn ? '◆ 出牌中' : '待命中') + '</div>' +
      '</div>';
  }

  /* ---------- 渲染：中央区 ---------- */
  function renderBoard() {
    if (!state) return;
    if (state.top) {
      el.topCardImg.src = cardImg(state.top);
      el.topCardImg.style.display = '';
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
    el.deckInner.textContent = (state.nextDraw > 0 ? '摸 ' + state.nextDraw : '摸牌');
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
      msg = '玩家 ' + (state.turn + 1) + ' 需摸 ' + state.nextDraw + ' 张';
      cls = ' warn';
    } else if (state.awaitColor) {
      msg = '等待玩家 ' + (state.turn + 1) + ' 选色';
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
    return w === me ? '🎉 恭喜你胜利了！' : ('😔 玩家 ' + (w + 1) + ' 获胜');
  }
  function showResult() {
    var r = el.resultBanner;
    r.textContent = winnerText();
    r.className = 'uo-result show' + ((mode !== '2v2' && state.winner === me) ? ' big' : '');
    r.hidden = false;
    if (window.Notify) {
      window.Notify.show(winnerText(), state.winner === (mode === '2v2' ? teamOfMe() : me) ? 'win' : 'lose', { sticky: true });
    }
    if (isHost) {
      setTimeout(function () {
        var again = document.createElement('button');
        again.className = 'btn on uo-again';
        again.textContent = '再来一局 →';
        again.addEventListener('click', function () { if (o) o.sendReset(); });
        r.appendChild(again);
      }, 800);
    }
  }

  /* ---------- 交互 ---------- */
  function bindUI() {
    el.myHand.addEventListener('click', function (e) {
      var wrap = e.target.closest('.uc-wrap');
      if (!wrap) return;
      var card = wrap.getAttribute('data-card');
      tryPlay(card);
    });
    el.btnDraw.addEventListener('click', function () {
      if (!canDrawNow()) return;
      if (o) o.sendDraw();
    });
    el.btnPass.addEventListener('click', function () {
      if (!passAllowed()) return;
      if (o) o.sendPass();
    });
    el.btnUno.addEventListener('click', function () {
      if (o) o.sendCallUno();
      el.btnUno.hidden = true;
    });
    el.colorModal.addEventListener('click', function (e) {
      var b = e.target.closest('.cp');
      if (!b) return;
      var color = b.getAttribute('data-c');
      if (o) o.sendSetColor(color);
      el.colorModal.hidden = true;
    });
  }

  function tryPlay(card) {
    if (!state || me !== state.turn || state.winner >= 0) return;
    if (state.awaitColor || state.nextDraw > 0) return;
    var hand = state.hand || [];
    if (hand.indexOf(card) < 0) return;
    var k = kindOf(card);
    if (!kindOk(card, state.top, state.topColor)) { flash('这张牌不能出'); return; }
    if (k === 'w4' && !w4RuleOk(card, hand, state.topColor)) { flash('有可出的同色牌时不能出 万色+4'); return; }
    if (o) o.sendPlay(card);
    // 出剩 1 张自动喊 UNO（4 秒宽容窗口内免罚）
    if (hand.length === 2) setTimeout(function () { if (o) o.sendCallUno(); }, 120);
  }

  function flash(msg) {
    el.banner.textContent = msg;
    el.banner.className = 'uo-banner warn shake';
    setTimeout(function () { if (el.banner.className.indexOf('shake') >= 0) el.banner.className = 'uo-banner'; }, 900);
  }

  /* ---------- 状态接收 ---------- */
  function applyState(s) {
    state = s;
    if (s.you != null) me = s.you;
    roomStarted = true;
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
    ['landscapeOverlay', 'gameRoot', 'gameView', 'oppRow', 'topCardImg', 'colorDot', 'btnDraw', 'deckInner',
     'banner', 'meLabel', 'btnUno', 'btnPass', 'myHand', 'mateRow', 'mateLabel', 'mateHand',
     'colorModal', 'resultBanner', 'roomCodeTag'].forEach(function (id) { el[id] = $(id); });

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', function () { setTimeout(checkOrientation, 120); });
    bindUI();

    if (q.mode !== 'online' || !q.room) {
      // 非联机（本地/AI 暂未开放）→ 提示返回
      if (window.Notify) window.Notify.show('匹配卡牌目前仅支持互联网对战（双人/三人/四人/2v2）', 'error', { sticky: true });
      setTimeout(function () { location.href = 'uno.html'; }, 1800);
      return;
    }

    currentRoom = q.room;
    if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + currentRoom; el.roomCodeTag.hidden = false; }

    o = new window.UnoOnline();
    o.code = currentRoom;

    // 统一等待室（与四款游戏同构）
    lobby = new window.GameLobby({
      onReady: function () { if (o) o.sendReady(); },
      onStart: function () { if (o) o.sendStart(); },
      onNotify: function () { if (o) o.sendNotify(); if (window.Notify) window.Notify.show('已提醒对方准备', 'info'); },
      onLeave: function () { if (o) o.sendLeave(); location.href = 'uno.html'; },
      shareExtra: '&gm=' + encodeURIComponent(mode)
    });
    lobby.setCapacity(capacityOf());
    if (mode === '2v2') lobby.setSeatTags(['下排', '下排', '上排', '上排']);
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