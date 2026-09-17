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
  var avatars = null;  // 联机房间各槽位自定义头像（lobby.avatars，dataURI）
  var isHost = false;
  var state = null;                // 最近一次裁剪视图
  var roomStarted = false;
  var lobby = null;                // GameLobby 实例
  var mode = q.gm || 'ffa';
  var currentRoom = q.room || '';

  /* ---------- 回合倒计时（10 秒时限） + 整局 4 分钟 ---------- */
  var TURN_SECONDS = 10;               // 每位玩家出牌时限
  var GAME_SECONDS = 180;              // 每局总时长 3 分钟
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

    function checkOrientation() {
    var landscape = window.innerWidth >= window.innerHeight;
    document.body.classList.toggle('portrait', !landscape);
    var lw = landscape ? window.innerWidth : window.innerHeight;
    var lh = landscape ? window.innerHeight : window.innerWidth;
    document.body.classList.remove('tier-short', 'tier-mid');
    document.body.classList.add(lh <= 430
      ? 'tier-short'
      : (lw <= 1024 ? 'tier-mid' : 'tier-wide'));
    // 竖屏：整体旋转 90°（画面横过来，用户转 90° 手机正看）
    el.landscapeOverlay.hidden = true;
  }


  /* ---------- 我的显示名：优先登录账号昵称，未登录兜底「你」 ---------- */
  function myName() {
    try {
      var u = (window.Auth && window.Auth.user && String(window.Auth.user).trim());
      if (u) return u.slice(0, 10);
      var lu = localStorage.getItem('game_username');
      if (lu && String(lu).trim()) return String(lu).trim().slice(0, 10);
    } catch (e) {}
    return '你';
  }

  /* ---------- 头像：用户自定义（localStorage.game_avatar）优先，缺省用默认图 ---------- */
  var DEFAULT_AVATAR = '../assets/default-avatar.jpg';
  function avatarSrc() {
    try {
      var a = localStorage.getItem('game_avatar');
      return (a && a.indexOf('data:image/') === 0) ? a : DEFAULT_AVATAR;
    } catch (e) { return DEFAULT_AVATAR; }
  }
  function avatarImg(cls, alt) {
    return '<img class="' + (cls || '') + '" src="' + avatarSrc() + '" alt="' + (alt || '') + '">';
  }

  /* ---------- 规则辅助（本地预检，服务端仍权威） ---------- */
  function kindOf(c) { if (c === 'w' || c === 'w4') return 'w'; return c.charAt(0); }
  // 符号类型（与引擎 kindOf 同语义）：'w'|'w4'|'s'|'r'(反转)|'d'(+2)|'n'(数字)
  function symOf(c) {
    if (c === 'w') return 'w';
    if (c === 'w4') return 'w4';
    var k = c.charAt(1);
    if (k === 's') return 's';
    if (k === 'r') return 'r';
    if (k === 'd') return 'd';
    return 'n';
  }
  function kindOk(c, top, color) {
    if (kindOf(c) === 'w') return true;
    if (kindOf(top) === 'w') return c.charAt(0) === color;
    return c.charAt(0) === color || c.charAt(1) === top.charAt(1);
  }
  
  function playableCards() {
    if (!state || state.awaitColor || me !== state.turn || state.winner >= 0) return [];
    var out = [];
    var h = state.hand || [];
    // 被 +2/+4 罚时：+2 可叠任何罚（不限颜色）；w4 可叠任何罚
    if (state.nextDraw > 0) {
      for (var m = 0; m < h.length; m++) {
        var mc = h[m];
        var mk = symOf(mc);
        if (mk === 'd') out.push(mc);
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
    cap = Math.min(cap, 4);
    // 按「相对我的顺时针顺序」摆位（我恒在下方）：
    //   4 人：me+1 左、me+2 对面（2v2 队友）、me+3 右
    //   3 人：me+1 左、me+2 右
    //   2 人：me+1 对面
    var posMap = cap === 4 ? ['left', 'top', 'right'] : (cap === 3 ? ['left', 'right'] : ['top']);
    var out = [];
    for (var i = 1; i < cap; i++) {
      out.push({ seat: ((me + i) % cap + cap) % cap, pos: posMap[i - 1] });
    }
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
    var isMate = false;
    if (mode === '2v2' && state && state.teams) {
      teamCls = state.teams[s] === state.teams[me] ? ' ta' : ' tb';
      isMate = state.teams[s] === state.teams[me];   // 队友 → 手牌正面朝上
    }
    var backs = '';
    // 队友：显示正面手牌（mateHand）；敌人：显示牌背
    if (isMate && state && state.mateHand) {
      // 队友只在 2v2 出现在对面（顶部）→ 牌翻转 180°（正面朝我）
      var mh = state.mateHand || [];
      var flipCls = '';
      seatSpots().forEach(function (it) { if (it.seat === s && it.pos === 'top') flipCls = ' flip'; });
      for (var mi = 0; mi < Math.min(mh.length, 12); mi++) {
        backs += '<img class="uc uc-hand ucmate' + flipCls + '" src="' + cardImg(mh[mi]) + '" alt="' + cardAlt(mh[mi]) + '">';
      }
      var n2 = state.mateHand.length;
      cntBadge = n2 > 12 ? '<span class="uo-p-cnt">' + n2 + '</span>' : '';
    } else {
      var n = Math.min(cnt, 12);
      for (var i = 0; i < n; i++) backs += '<div class="uo-back"></div>';
      var cntBadge = cnt > 12 ? '<span class="uo-p-cnt">' + cnt + '</span>' : '';
    }
    // 对手头像优先级：联机对手真实头像 > 本机自定义 > 默认图；
    // AI 对手（名字带 AI· 前缀或 AI 模式）恒用默认图
    var oppAvatar = DEFAULT_AVATAR;
    if (!((names && names[s] && names[s].indexOf('AI') >= 0) || mode === 'ai')) {
      if (avatars && avatars[s] && avatars[s].indexOf('data:image/') === 0) oppAvatar = avatars[s];
      else oppAvatar = avatarSrc();
    }
    return '<div class="uo-p-card' + (isTurn ? ' turn' : '') + '">' +
      '<div class="uo-p-avatar">' + '<img src="' + oppAvatar + '" alt="">' + '</div>' +
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
    renderBanner();
    var myDraw = canDrawNow();
    el.btnDraw.disabled = !myDraw;
    el.btnDraw.classList.toggle('on', myDraw);
    // 质疑 +4：被加人轮到且未操作时显示 质疑/接受 双按钮
    var canChallenge = !!(state.challenge && state.nextDraw > 0 && me === state.turn && state.winner < 0);
    if (el.btnChallenge) {
      el.btnChallenge.hidden = !canChallenge;
      el.btnAccept.hidden = !canChallenge;
      if (el.challengeLine) el.challengeLine.hidden = !canChallenge;
      el.btnDraw.classList.toggle('with-challenge', canChallenge);
      if (el.btnPlayDrawn) el.btnPlayDrawn.hidden = canChallenge ? true : el.btnPlayDrawn.hidden;
      if (el.btnPass) el.btnPass.hidden = canChallenge ? true : el.btnPass.hidden;
    }
    // 抽牌后操作区：刚摸的牌能打 → 打出/不出 双按钮；不能打 → 打出暗色
    if (el.btnPlayDrawn && !canChallenge) {
      var pd = !!state && me === state.turn && state.justDrew && state.nextDraw === 0 && state.winner < 0 && !state.awaitColor;
      var drawnPlayable = pd && !!state.lastDrawn && playableCards().indexOf(state.lastDrawn) >= 0;
      el.btnPlayDrawn.hidden = !pd;
      el.btnPlayDrawn.classList.toggle('dim', !drawnPlayable);
      el.btnPlayDrawn.disabled = !drawnPlayable;
      if (el.btnPass) {
        el.btnPass.hidden = !pd;
        el.btnPass.disabled = false;
      }
    } else if (el.btnPass) {
      el.btnPass.hidden = !passAllowed();
    }
  }
  function colorCss(c) { return { r: '#e5484d', b: '#3e8ef7', g: '#2ebd59', y: '#f5c542' }[c] || '#888'; }
  function colorLabel(c) { return { r: '红', b: '蓝', g: '绿', y: '黄' }[c] || ''; }

  /* 横幅：已整体移除（不再显示任何横幅/空白容器），效果反馈改由 toast 承担 */
  function renderBanner() {
    if (!el.banner) return;
    el.banner.textContent = '';
    el.banner.className = 'uo-banner';
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
      // 刚摸的牌（lastDrawn）：若能打出 → 上移高亮（drawn 视觉），并禁止点其它牌
      var isDrawn = state.justDrew && c === state.lastDrawn;
      var wrapCls = (p ? ' ok' : ' no') + (isDrawn ? ' drawn' : '') + (state.justDrew && !isDrawn ? ' locked' : '');
      html += '<div class="uc-wrap' + wrapCls + '" data-card="' + c + '" data-idx="' + i + '">' +
        '<img class="uc uc-hand' + (p ? ' glow' : '') + (isDrawn ? ' drawn-glow' : '') + '" src="' + cardImg(c) + '" alt="' + cardAlt(c) + '"></div>';
    }
    el.myHand.innerHTML = html;
    if (h.length === 0) el.myHand.innerHTML = '<div class="uo-empty">已出完</div>';

    // 队友手牌已直接在对面头像下方正面显示（oppCard），不再底部两行
    if (el.mateRow) el.mateRow.hidden = true;

    // UNO 按钮常驻：剩 1 张且未出完时激活（不弹隐藏）；播放中且轮到我全会弹出提示
    var unoActive = (h.length === 1 && state.winner < 0);
    el.btnUno.classList.toggle('on', unoActive);
    if (state.winner >= 0) el.btnUno.classList.add('off'); else el.btnUno.classList.remove('off');
    var meTurn = me === state.turn && state.awaitColor === false && state.winner < 0;
    if (meTurn && state.nextDraw > 0) meTurn = playable.length > 0;   // 被罚：有叠牌才可交互
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
  /* 统一结算覆盖层（ResultOverlay）：支持单人混战（2-4 人）与 2v2 组队 */
  /* ===== 官方 UNO 记分规则 =====
 * 牌面分：数字=面值 / 跳过·反转·+2 = 20 / 万色·万色+4 = 50
 * 单局结算：先出完的玩家(或队伍)赢得本局，得分 = 其余玩家手牌分总和
 * 多局累积：先到 500 分者赢得整个游戏（经典规则）
 */
function cardScore(card) {
    if (!card || card === 'w') return 50;
    if (card === 'w4') return 50;
    var k = card.charAt(1);
    if (k === 's' || k === 'r' || k === 'd') return 20;   // 跳过/反转/+2
    var n = parseInt(k, 10);
    return isNaN(n) ? 0 : n;                              // 数字牌 = 面值
}
function handScore(hand) {
    if (!hand) return 0;
    var sum = 0;
    for (var i = 0; i < hand.length; i++) sum += cardScore(hand[i]);
    return sum;
}
// 多局累积分（localStorage 持久化，先到 500 局点）
function showResultOverlay() {
    if (!window.ResultOverlay) return;
    var w = state.winner;
    var cnt = state.counts || [];
    var nameOf = function (s) { return (names && names[s]) ? names[s] : ('玩家 ' + (s + 1)); };
    if (mode === '2v2') {                         // ===== 组队（2v2）单局积分 =====
      var myTeam = teamOfMe();
      var scoreSums = (state && state.scores) || (state.hands ? state.hands.map(handScore) : []);
      var teamPts = [0, 0], teamCnt = [0, 0];
      var seatCap2 = (state && state.capacity) || cnt.length;
      for (var s = 0; s < seatCap2; s++) {
        var t = (state.teams && state.teams[s] != null) ? state.teams[s] : 0;
        teamPts[t] += scoreSums[s] || 0;
        teamCnt[t] += 1;
      }
      // 赢队 = 手牌分合计最小的队（0=出完）；输队 = 另一队
      var winTeam = teamPts[0] <= teamPts[1] ? 0 : 1;
      var loseTeam = 1 - winTeam;
      var winGain = teamPts[loseTeam] - teamPts[winTeam];     // 赢队得分 = 对方合计 − 自己合计
      var loseGain = -teamPts[loseTeam] + teamPts[winTeam] / Math.max(1, teamCnt[loseTeam]);  // 输队 = −自己 + 赢队分÷输队人数
      var myName = nameOf(me);
      var foeName = '';
      for (var fi = 0; fi < seatCap2; fi++) if ((state.teams && state.teams[fi] === (1 - myTeam))) { foeName = nameOf(fi); break; }
      if (!foeName) foeName = '对方';
      var meWonRound = (winTeam === myTeam);
      ResultOverlay.show({
        game: '优诺', title: meWonRound ? '🎉 你的队伍获胜！' : '😔 对方队伍获胜',
        sub: '赢队 +' + Math.round(winGain) + ' · 输队 ' + Math.round(loseGain),
        meRank: meWonRound ? 1 : 2,
        me: { name: myName + ' 队', score: String(Math.round(meWonRound ? winGain : loseGain)), tag: meWonRound ? '本局得分' : '本局得分' },
        players: [
          { name: myName + ' 队', score: String(Math.round(winTeam === myTeam ? winGain : loseGain)), tag: winTeam === myTeam ? '胜 · 本局得分' : '负 · 本局得分' },
          { name: foeName + ' 队', score: String(Math.round(winTeam !== myTeam ? winGain : loseGain)), tag: winTeam !== myTeam ? '胜 · 本局得分' : '负 · 本局得分' }
        ],
        stats: [['规则', '官方牌面分 · 单局积分'], ['牌面分值', '数字=面值 / 功能=20 / 万色=50'], ['赢队', '对方手牌分 − 自己手牌分'], ['输队', '−自己手牌分 + 赢队分÷输队人数']]
      });
      return;
    }
    // ===== 单人混战（2-4 人）单局积分 =====
    var scoreSums = (state && state.scores) || (state.hands ? state.hands.map(handScore) : []);
    var seatCap = (state && state.capacity) || cnt.length;
    var seats = [];
    for (var i = 0; i < seatCap; i++) seats.push({ seat: i, cnt: cnt[i], pts: scoreSums[i] || 0 });
    seats.sort(function (a, b) { return (a.pts - b.pts); });   // 手牌分最小（0=出完）的赢
    var winnerSeat = seats[0].seat;
    var winnerPts = seats[0].pts;
    var othersSum = 0;
    for (var oi = 0; oi < seats.length; oi++) if (seats[oi].seat !== winnerSeat) othersSum += seats[oi].pts;
    var loserCount = Math.max(1, seats.length - 1);
    var deltas = {};
    deltas[winnerSeat] = othersSum - winnerPts;                 // 赢家 = 别人总和 − 自己
    for (var di = 0; di < seats.length; di++) {
      var s2 = seats[di].seat;
      if (s2 !== winnerSeat) deltas[s2] = -seats[di].pts + winnerPts / loserCount;   // 输家 = −自己 + 赢家分÷输家数
    }
    var players = seats.map(function (o) {
      var d = deltas[o.seat];
      return { name: nameOf(o.seat) + (o.seat === me ? '（我）' : ''),
               score: String(Math.round(d)),
               tag: o.seat === winnerSeat ? '胜 · 本局得分' : '负 · 本局得分' };
    });
    var meIdx = 0;
    for (var k = 0; k < seats.length; k++) if (seats[k].seat === me) meIdx = k;
    var meWin = (winnerSeat === me);
    ResultOverlay.show({
      game: '优诺',
      title: meWin ? '🎉 你赢了！' : '😔 ' + nameOf(winnerSeat) + ' 获胜',
      sub: '赢家 +' + Math.round(deltas[winnerSeat]) + ' · 输家扣自己手牌分',
      meRank: meIdx + 1,
      me: { name: nameOf(me), score: String(Math.round(deltas[me])), tag: meWin ? '本局得分' : '本局得分' },
      players: players,
      stats: [['规则', '官方牌面分 · 单局积分'], ['牌面分值', '数字=面值 / 功能=20 / 万色=50'], ['赢家', '别人手牌分 − 自己手牌分'], ['输家', '−自己手牌分 + 赢家分÷输家人数']]
    });
  }
 // 整局时间到：全屏「时间到！」2 秒 → 强制结算（按当前手牌分排名）
  function forceTimeUp() {
    var ov = document.getElementById('timeUpOverlay');
    if (ov) ov.hidden = false;
    setTimeout(function () {
      if (ov) ov.hidden = true;
      finishByTimeUp();
    }, 2000);
  }
  // 时间到结算：无出完者时按手牌分最小者判胜（模拟 winner 并走统一结算）
  function finishByTimeUp() {
    if (!state || state.winner >= 0) return;
    var cnt = state.counts || [];
    var seatCap = (state && state.capacity) || cnt.length;
    var scoreSums = (state && state.scores) || (state.hands ? state.hands.map(handScore) : []);
    if (mode === '2v2') {
      var tp = [0, 0];
      for (var s = 0; s < seatCap; s++) {
        var t = (state.teams && state.teams[s] != null) ? state.teams[s] : 0;
        tp[t] += scoreSums[s] || 0;
      }
      var winT = tp[0] <= tp[1] ? 0 : 1;
      state.winner = winT;
    } else {
      var best = 0, bestPts = Infinity;
      for (var s = 0; s < seatCap; s++) {
        if ((scoreSums[s] || 0) < bestPts) { bestPts = scoreSums[s] || 0; best = s; }
      }
      state.winner = best;
    }
    showResult();
    if (window.Notify) window.Notify.show('⏱ 时间到！按手牌分最少者结算', 'warn');
  }
  function showResult() {
    var r = el.resultBanner;
    r.textContent = winnerText();
    r.className = 'uo-result show' + ((mode !== '2v2' && state.winner === me) ? ' big' : '');
    r.hidden = false;
    showResultOverlay();
    if (window.Notify) {
      window.Notify.show(winnerText(), state.winner === (mode === '2v2' ? teamOfMe() : me) ? 'win' : 'lose', { sticky: true });
    }
    if (isHost || mode === 'ai') {
      setTimeout(function () {
        var again = document.createElement('button');
        again.className = 'btn on uo-again';
        again.textContent = '再来一局 →';
        again.addEventListener('click', function () {
          gameSeconds = GAME_SECONDS;        // 新一局重置整局时钟与超时通知
          gameOverNotified = false;
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
    if (!holder || !state || !state.top) return;
    // 起点：牌背堆（.uo-p-hand 的第一张牌背）——头像在 firstChild，牌背才是牌桌视觉起点
    var handEl = holder.querySelector('.uo-p-hand');
    var srcEl = (handEl && handEl.firstElementChild) || holder.firstChild;
    if (!srcEl) return;
    flyFromRect(srcEl.getBoundingClientRect(), state.top, null);
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
    // 质疑 +4：质疑者赌出牌者违规
    if (el.btnChallenge) el.btnChallenge.addEventListener('click', function () {
      if (!(state && state.challenge && state.nextDraw > 0 && me === state.turn)) return;
      if (mode === 'ai') {
        var before = state.hands ? state.hands.map(function (h) { return h.length; }) : [];
        localStep(function (s) { Uno.challengeW4(s, me); });
        var after = state.hands ? state.hands.map(function (h) { return h.length; }) : [];
        // 结果提示：质疑者手牌多了8 → 失败；出牌者多了4 → 成功
        if (after[me] > before[me]) {
          if (window.Notify) window.Notify.show('质疑失败！对方确实没有同色牌，你 +8 张', 'error', { sticky: true });
        } else {
          if (window.Notify) window.Notify.show('质疑成功！出牌者违规 +4 张', 'win', { sticky: true });
        }
      } else if (o && o.sendChallenge) o.sendChallenge();
      if (el.challengeLine) el.challengeLine.hidden = true;
    });
    // 接受 +4：不质疑，直接吃罚
    if (el.btnAccept) el.btnAccept.addEventListener('click', function () {
      if (!(state && state.challenge && state.nextDraw > 0 && me === state.turn)) return;
      if (mode === 'ai') localStep(function (s) { Uno.draw(s, me); });   // 被动吃罚
      else if (o) o.sendDraw();
      if (el.challengeLine) el.challengeLine.hidden = true;
    });
    el.btnPass.addEventListener('click', function () {
      if (!passAllowed()) return;
      if (mode === 'ai') localStep(function (s) { Uno.pass(s, me); });
      else if (o) o.sendPass();
    });
    // 抽牌后「打出」：把刚摸的牌打出去（走 tryPlay 路径，含飞牌动画）
    if (el.btnPlayDrawn) {
      el.btnPlayDrawn.addEventListener('click', function () {
        if (!state || state.justDrew !== true || me !== state.turn) return;
        var cd = state.lastDrawn;
        if (!cd || playableCards().indexOf(cd) < 0) return;
        var wraps = el.myHand.querySelectorAll('.uc-wrap');
        var target = null;
        [].forEach.call(wraps, function (w2) { if (w2.getAttribute('data-card') === cd && !target) target = w2; });
        if (target) tryPlay(cd, target, false);
        else if (mode === 'ai') { Uno.play(localState, me, cd); applyLocalView(); maybeLocalAI(); }
        else if (o) o.sendPlay(cd);
      });
    }
    // 我的头像（用户自定义优先，无则默认）+ 显示名（真人用户名，未登录才「你」）
    el.meAvatar.innerHTML = avatarImg('', myName());
    el.meLabel.textContent = myName();

    el.btnUno.addEventListener('click', function () {
      if (!el.btnUno.classList.contains('on')) return;   // 非激活（未剩 1 张）不响应
      if (mode === 'ai') { Uno.callUno(localState, me); renderMe(); }
      else if (o) o.sendCallUno();
      el.btnUno.classList.remove('on');
    });
    // 万色选色：UNO 官方风格——点选后全部色块注入所选颜色，再收合
    var cmBusy = false;
    el.colorModal.addEventListener('click', function (e) {
      var chip = e.target.closest('.uno-cm-chip');
      if (!chip || cmBusy) return;
      cmBusy = true;
      var color = chip.getAttribute('data-c');
      var chips = el.colorModal.querySelectorAll('.uno-cm-chip');
      // 1) 点击的色块脉冲放大 + 扩散环
      chip.classList.add('picked');
      // 2) 取所选颜色（从被点色块的 CSS 变量）
      var cs = getComputedStyle(chip);
      var cClr = cs.getPropertyValue('--clr').trim();
      var cD = cs.getPropertyValue('--clr-d').trim();
      var cL = cs.getPropertyValue('--clr-l').trim();
      // 3) 其余色块依次「注入」所选颜色（间隔 90ms 波浪）
      [].forEach.call(chips, function (el2, i) {
        if (el2 === chip) return;
        setTimeout(function () {
          el2.classList.add('flood');
          el2.style.setProperty('--clr', cClr);
          el2.style.setProperty('--clr-d', cD);
          el2.style.setProperty('--clr-l', cL);
        }, 120 + i * 90);
      });
      // 4) 全部注入完成后面板收合，提交选色
      setTimeout(function () {
        el.colorModal.classList.add('out');
        setTimeout(function () {
          el.colorModal.hidden = true;
          el.colorModal.classList.remove('out');
          [].forEach.call(chips, function (el2) {
            el2.classList.remove('picked', 'flood');
          });
          if (mode === 'ai') { Uno.setColor(localState, me, color); applyLocalView(); maybeLocalAI(); }
          else if (o) o.sendSetColor(color);
          cmBusy = false;
        }, 300);
      }, 120 + chips.length * 90 + 160);
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
    // 抽牌后只能出刚摸的那张（或过），点其它牌直接忽略
    if (state.justDrew && card !== state.lastDrawn) return;
    var hand = state.hand || [];
    if (hand.indexOf(card) < 0) return;
    var k = symOf(card);
    if (state.nextDraw > 0) {
      // 叠加：+2 / +4 可叠任何罚（不限颜色）
      if (k !== 'd' && k !== 'w4') return;
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
      turn: s.turn, dir: s.dir, nextDraw: s.nextDraw, drawKind: s.drawKind ?? 0, awaitColor: s.awaitColor,
      justDrew: s.justDrew, lastDrawn: s.lastDrawn, uno: s.uno, winner: s.winner,
      challenge: s.challenge ? { victim: s.challenge.victim, by: s.challenge.by, color: s.challenge.color } : null,
      hand: s.hands[me].slice(), counts: s.hands.map(function (h) { return h.length; }), scores: s.hands.map(handScore),
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
    names = [myName(), 'AI·2', 'AI·3'];
    roomStarted = true;
    isHost = false;
    if (el.unoGameTitle) el.unoGameTitle.style.display = 'none';
    el.gameRoot.hidden = false;
    lastTurn = -1;
    applyLocalView();
    maybeLocalAI();
  }
  function applyLocalView() {
    // 与联机 applyState 同款：先记 prevTurn/topChanged 再更新 state，再播对手飞牌动画
    var prevTurn = state ? state.turn : -1;
    var topChanged = !state || state.top !== localState.top;
    state = toLocalView(localState);
    renderOpps(); renderBoard(); renderMe();
    if (topChanged && state.top && prevTurn >= 0 && prevTurn !== me) oppFlyIn(prevTurn);
    // 万色选色弹窗（AI 局同步）：轮到我且 awaitColor 时弹出
    if (me === state.turn && state.awaitColor && state.winner < 0) el.colorModal.hidden = false;
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
    if (localState.challenge) return;   // 挑战窗口：AI 不自动操作（等玩家决策）
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
    var r = Uno.play(localState, me, card);
    if (r && r.ok && localState.hands[me].length === 1) Uno.callUno(localState, me);
    applyLocalView();
    // 双保险：出的是万色牌（w/w4）且 awaitColor → 弹窗立即打开
    if (r && r.ok && localState.awaitColor && localState.turn === me && localState.winner < 0) {
      el.colorModal.hidden = false;
    }
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
    ;
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
      avatars = (d.avatars && d.avatars.length) ? d.avatars : null; // 各槽位自定义头像
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
  /* ========== 素材预加载器：全屏遮罩 + 实时进度 ==========
 * 收集：背景图 + 全部卡牌（按引擎牌型全集生成 cards/*.png 路径）
 * 进度：逐个 new Image 加载，onload/onerror 都推进；实时更新遮罩 UI
 * 完成：遮罩淡出 → onLoaded()（AI 局开局 / 联机显示等待室）
 */
var PRELOAD_ASSETS = (function () {
  var files = [];
  // 背景图
  files.push('assets/uno-bg-wide.jpg');
  // 全部卡牌：4 色 × (0-9 + S/R/A2) + WC + W4
  ['R', 'B', 'G', 'Y'].forEach(function (c) {
    files.push('cards/' + c + '0.png');
    for (var n = 1; n <= 9; n++) files.push('cards/' + c + n + '.png');
    files.push('cards/' + c + 'S.png', 'cards/' + c + 'R.png', 'cards/' + c + 'A2.png');
  });
  files.push('cards/WC.png', 'cards/W4.png');
  files.push('cards/back.png');
  // 喊 UNO 按钮图（避免首局按钮空白）
  files.push('assets/uno-button.png');
  return files;
})();

function preloadAssets(onLoaded) {
  var ov = document.getElementById('loadingOverlay');
  var bar = document.getElementById('ulBar');
  var pct = document.getElementById('ulPct');
  var fileEl = document.getElementById('ulFile');
  if (!ov) { if (onLoaded) onLoaded(); return; }

  var list = PRELOAD_ASSETS.slice();
  var sizes = new Array(list.length).fill(0);
  var totalBytes = 0, doneBytes = 0, nextIdx = 0, inflight = 0;
  var finished = false;
  var DLOAD_CONC = 4;    // 下载并发
  var PROBE_CONC = 8;    // 探测并发（快）

  function setPct() {
    var p = totalBytes > 0 ? Math.max(0, Math.min(99, Math.round(doneBytes / totalBytes * 100)))
                           : (list.length ? Math.round(Math.min(nextIdx, list.length) / list.length * 100) : 0);
    if (bar) bar.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }
  function fmt(b) {
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(globalTimer);
    if (fileEl) fileEl.textContent = '加载完成';
    if (bar) bar.style.width = '100%';
    if (pct) pct.textContent = '100%';
    setTimeout(function () {
      ov.classList.add('done');
      setTimeout(function () { ov.style.display = 'none'; }, 550);
      if (onLoaded) onLoaded();
    }, 200);
  }
  // 全局保险 25s（探测 3s + 下载 20s）
  var globalTimer = setTimeout(finish, 25000);

  // ---------- 阶段一：快速并发探测尺寸（HEAD 并行、1.5s 超时、失败记 0） ----------
  function probeAll(onDone) {
    var doneCnt = 0, probeFlight = 0, pi = 0;
    var settledOnce = new Array(list.length).fill(false);   // 每个资源只结算一次
    function settle() {
      doneCnt++;
      if (doneCnt >= list.length) { onDone(); return; }
      pumpProbe();
    }
    function pumpProbe() {
      while (probeFlight < PROBE_CONC && pi < list.length) {
        var k = pi;
        pi++;
        probeFlight++;
        var ctrl = null;
        try { ctrl = new AbortController(); } catch (e) {}
        var t = setTimeout(function () {
          // 超时：标记并结算（幂等）
          if (!settledOnce[k]) {
            settledOnce[k] = true;
            sizes[k] = 0;
            probeFlight--;
            settle();
          }
        }, ctrl ? 1500 : 0);
        if (!ctrl) { if (!settledOnce[k]) { settledOnce[k] = true; sizes[k] = 0; probeFlight--; settle(); } continue; }
        (function (kk, tt) {
          fetch(list[kk], { method: 'HEAD', signal: ctrl.signal })
            .then(function (r) {
              clearTimeout(tt);
              if (settledOnce[kk]) return;
              settledOnce[kk] = true;
              var cl = parseInt(r.headers.get('Content-Length') || '0', 10);
              sizes[kk] = (isNaN(cl) || cl <= 0) ? 0 : cl;
              probeFlight--;
              settle();
            })
            .catch(function () {
              clearTimeout(tt);
              if (settledOnce[kk]) return;
              settledOnce[kk] = true;
              sizes[kk] = 0;
              probeFlight--;
              settle();
            });
        })(k, t);
      }
    }
    if (!list.length) { onDone(); return; }
    pumpProbe();
  }// ---------- 阶段二：并发下载（totalBytes 固定，进度单调到 100%） ----------
  function startDownload() {
    for (var i = 0; i < list.length; i++) totalBytes += sizes[i];   // 一次性求和，总量固定
    if (totalBytes <= 0 && list.length) totalBytes = list.length;   // 全部失败按个数兜底
    if (fileEl) fileEl.textContent = '开始下载…';
    setPct();
    nextIdx = 0; inflight = 0;
    pump();
  }
  function downOne(k) {
    var f = list[k];
    var ctrl = null;
    try { ctrl = new AbortController(); } catch (e) {}
    var t = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, 10000);
    if (!ctrl) { inflight--; pump(); return; }
    fetch(f, { signal: ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('fail');
        return r.blob();
      })
      .then(function (blob) {
        clearTimeout(t);
        var url = URL.createObjectURL(blob);
        var im = new Image();
        im.onload = im.onerror = function () {
          try { URL.revokeObjectURL(url); } catch (e) {}
          doneBytes += (sizes[k] > 0 ? sizes[k] : blob.size);
          inflight--;
          if (fileEl) fileEl.textContent = '正在下载 ' + f + '  (' + fmt(doneBytes) + ' / ' + fmt(totalBytes) + ')';
          setPct();
          pump();
        };
        im.src = url;
      })
      .catch(function () {
        clearTimeout(t);
        inflight--;
        pump();
      });
  }
  function pump() {
    while (inflight < DLOAD_CONC && nextIdx < list.length) {
      inflight++;
      downOne(nextIdx);
      nextIdx++;
    }
    if (inflight === 0 && nextIdx >= list.length) { finish(); }
  }

  if (!list.length) { finish(); return; }
  // 探测阶段文案
  if (fileEl) fileEl.textContent = '正在探测资源…';
  probeAll(startDownload);
}
function boot() {
    ['landscapeOverlay', 'gameRoot', 'gameView', 'playerTop', 'playerLeft', 'playerRight',
     'topCardImg', 'btnDraw', 'turnTimer',
     'banner', 'meLabel', 'meAvatar', 'btnUno', 'btnPass', 'btnPlayDrawn', 'btnAccept', 'challengeLine', 'myHand', 'mateRow', 'mateLabel', 'mateHand',
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

        preloadAssets(function () {
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
    if (mode === '2v2') {
      lobby.setSeatTags(['1队', '2队', '1队', '2队']);   // 2v2 交叉坐：0/2 一队、1/3 一队
      // 等待室是 2×2 网格：重排视觉顺序为 [0,2,1,3] → 每行两个是队友
      //   seat0(slot0,1队) seat2(slot2,1队)
      //   seat1(slot1,2队) seat3(slot3,2队)
      var ordMap = { seat0: 1, seat2: 2, seat1: 3, seat3: 4 };
      Object.keys(ordMap).forEach(function (id) {
        var el2 = document.getElementById(id);
        if (el2) el2.style.order = String(ordMap[id]);
      });
    }
    lobby.show(currentRoom);
    lobby.setStatus('连接中…', 'connecting');

    bindOnline(o);
    o.connect(q.role === 'host' ? 0 : 1).catch(function () {
      if (window.Notify) window.Notify.show('连接失败，正在重连…', 'warn', { sticky: true });
    });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();