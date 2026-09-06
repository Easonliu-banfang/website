/* 匹配卡牌（UNO）游戏前端：URL 驱动开局、渲染裁剪视图、出牌/摸牌/选色交互 */
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
  var lobby = null;                // 最近一次 lobby
  var offlineMsgShown = false;
  var mode = q.gm || '2';

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

  /* ---------- 引擎辅助：我的可出牌 ---------- */
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
  function canDrawNow() {
    if (!state || state.winner >= 0 || me !== state.turn || state.awaitColor) return false;
    if (state.justDrew) return false;   // 主动摸 1 后只能出或过
    return true;   // 有可出牌也能摸（摸后可过）+ 无牌可出必摸
  }
  function passAllowed() { return !!state && !state.awaitColor && me === state.turn && state.justDrew && state.nextDraw === 0 && state.winner < 0; }

  /* ---------- 渲染：大厅座位 ---------- */
  function renderLobby() {
    var capacity = capacityOf();
    var l = lobby || { players: [], ready: [], host: 0 };
    var html = '';
    for (var s = 0; s < capacity; s++) {
      var occupied = !!l.players[s];
      var isMe = s === me;
      html += '<div class="uoseat' + (occupied ? ' on' : '') + (isMe ? ' me' : '') + '" data-slot="' + s + '">' +
        '<span class="uoseat-n">' + (s + 1) + '</span>' +
        '<span class="uoseat-name">' + (occupied ? ('玩家 ' + (s + 1)) + (isMe ? '（你）' : '') : '等待加入…') + '</span>' +
        (mode === '2v2' ? '<span class="uoseat-team t' + (s < 2 ? 'a' : 'b') + '">' + (s < 2 ? '下排' : '上排') + '</span>' : '') +
        (isMe && (l.host === me) ? '<span class="uoseat-host">房主</span>' : '') +
        '</div>';
    }
    el.unoSeats.innerHTML = html;
    el.btnStart.hidden = !isHost || (lobby && lobby.started);
    var joined = (l.players || []).filter(Boolean).length;
    el.lobbyTip.textContent = '将房间码发给好友（' + joined + '/' + capacity + '）' + (mode === '2v2' ? '，下排/上排各一队' : '') + '，全员到齐后由房主开始';
  }
  function capacityOf() {
    if (mode === '2v2') return 4;
    var n = parseInt(mode, 10);
    return (n === 3 || n === 4) ? n : 2;
  }

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
    // opponentsList 需要 state.mate 存在；2v2 之前 state 没到时直接全列
    var html = '';
    for (var i = 0; i < opps.length; i++) {
      var s = opps[i];
      if (s >= 4) continue;
      html += oppCard(s, mode === '2v2');
    }
    // 双人：只有一个对手对面
    el.oppRow.innerHTML = html;
  }
  function oppCard(s, isTeamMode) {
    var cnt = state ? state.counts[s] : 0;
    var isTurn = state && state.turn === s;
    var uno = state && state.uno && state.uno[s];
    var online = lobby && lobby.players && lobby.players[s];
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
      '<div class="uo-opp-foot">' + (isTurn ? '◆ 出牌中' : (online === false ? '离线' : '待命中')) + '</div>' +
      '</div>';
  }
  function teamOf(s) { return state && state.teams ? state.teams[s] : 0; }
  function teamOfMe() { return teamOf(me); }
  function opponentTeamTag(s) {
    if (state && state.teams) return state.teams[s] === state.teams[me] ? 'a' : 'b';
    return (s < 2 ? 'a' : 'b');
  }

  /* ---------- 渲染：中央区 ---------- */
  function renderBoard() {
    if (!state) return;
    // 顶牌
    if (state.top) {
      el.topCardImg.src = cardImg(state.top);
      el.topCardImg.style.display = '';
    } else {
      el.topCardImg.style.display = 'none';
    }
    // 当前色
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
    // 回合提示 + 效果横幅
    renderBanner();
    // 摸牌按钮状态
    var myDraw = canDrawNow();
    el.btnDraw.disabled = !myDraw;
    el.btnDraw.classList.toggle('on', myDraw);
    el.deckInner.textContent = (state.nextDraw > 0 ? '摸 ' + state.nextDraw : '摸牌');
    // 过按钮
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
      msg = '轮到玩家 ' + (state.turn + 1) + (dirLabel());
      cls = '';
    }
    b.textContent = msg;
    b.className = 'uo-banner' + cls;
  }
  function dirLabel() {
    if (state && state.dir < 0) return '（逆向）';
    return '';
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

    // 队友手牌（2v2）
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

    // 自己的 UNO 状态（剩 1 张高亮）
    el.btnUno.hidden = !(h.length === 1 && state.winner < 0);
    // 出牌高亮
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
    if (isHost) {
      setTimeout(function () {
        var again = document.createElement('button');
        again.className = 'btn on uo-again';
        again.textContent = '再来一局 →';
        again.addEventListener('click', function () { o.send({ type: 'reset' }); });
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
      o.send({ type: 'draw' });
    });
    el.btnPass.addEventListener('click', function () {
      if (!passAllowed()) return;
      o.send({ type: 'pass' });
    });
    el.btnUno.addEventListener('click', function () {
      o.send({ type: 'callUno' });
      el.btnUno.hidden = true;
    });
    el.colorModal.addEventListener('click', function (e) {
      var b = e.target.closest('.cp');
      if (!b) return;
      var color = b.getAttribute('data-c');
      o.send({ type: 'setColor', color: color });
      el.colorModal.hidden = true;
    });
    el.btnStart.addEventListener('click', function () {
      o.send({ type: 'start' });
      el.btnStart.hidden = true;
    });
    el.btnLeave.addEventListener('click', function (e) {
      if (!confirm('确定离开当前对局吗？')) e.preventDefault();
      else { try { o && o.close(); } catch (err) {} }
    });
  }

  function tryPlay(card) {
    if (!state || me !== state.turn || state.winner >= 0) return;
    if (state.awaitColor) return;
    if (state.nextDraw > 0) return;
    var E = window.Uno;
    var hand = state.hand || [];
    if (hand.indexOf(card) < 0) return;
    var k = kindOf(card);
    // 本地预检（服务端仍权威）
    if (!kindOk(card, state.top, state.topColor)) { flash('这张牌不能出'); return; }
    if (k === 'w4' && !w4RuleOk(card, hand, state.topColor)) { flash('有可出的同色牌时不能出 万色+4'); return; }
    o.send({ type: 'play', card: card });
    // 出剩 1 张自动喊 UNO（4 秒宽容窗口内免罚）
    if (hand.length === 2) setTimeout(function () { o.send({ type: 'callUno' }); }, 120);
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
    if (s.winner >= 0) { showResult(); }
    else if (el.resultBanner) el.resultBanner.hidden = true;   // 重开/进入后复位
    el.gameView.hidden = false;
    el.lobbyView.hidden = true;
    renderOpps();
    renderBoard();
    renderMe();
    // 若我轮到选色，弹窗
    if (me === s.turn && s.awaitColor && s.winner < 0) {
      el.colorModal.hidden = false;
    }
  }

  function applyPlayers(players) {
    if (!lobby) lobby = { players: [], ready: [], host: -1, started: true };
    lobby.players = players;
    if (!state) renderLobby();
    else renderOpps();
  }

  /* ---------- 启动 ---------- */
  function boot() {
    ['landscapeOverlay', 'topMode', 'topRoom', 'lobbyView', 'unoSeats', 'btnStart', 'lobbyTip',
     'gameView', 'oppRow', 'topCardImg', 'colorDot', 'btnDraw', 'deckInner', 'banner',
     'meLabel', 'btnUno', 'btnPass', 'myHand', 'mateRow', 'mateLabel', 'mateHand',
     'colorModal', 'resultBanner', 'btnLeave'].forEach(function (id) { el[id] = $(id); });

    el.topMode.textContent = MODE_LABEL[mode] || '';
    el.topRoom.textContent = '房间 ' + (q.room || '----');

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', function () { setTimeout(checkOrientation, 120); });
    bindUI();

    if (q.mode !== 'online' || !q.room) {
      // 非联机（本地/AI 暂未开放）→ 提示返回
      el.banner.textContent = '匹配卡牌目前仅支持互联网对战（双人/三人/四人/2v2）';
      setTimeout(function () { location.href = 'uno.html'; }, 1600);
      return;
    }

    o = new window.UnoOnline();
    o.code = q.room;

    o.on('welcome', function (m) {
      me = m.player;
      isHost = me === 0;
    });
    o.on('lobby', function (m) {
      lobby = m;
      if (!state) renderLobby();
      if (m.started && !state) { /* 进场时已开始，等 state */ }
    });
    o.on('players', function (m) { applyPlayers(m.players); });
    o.on('state', function (m) { applyState(m.state); });
    o.on('error', function (m) {
      if (m && m.msg) flash(m.msg);
    });

    var preferred = (q.role === 'host') ? 0 : -1;
    o.connect(preferred).catch(function (err) {
      el.banner.textContent = '连接失败，正在重连…';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();