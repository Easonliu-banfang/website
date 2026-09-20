/* 骗子酒馆 · Liar's Table
 * 移植自 Hanazar-Games/Liars-Bar-webgame（MIT License）
 * 单人 AI + 联机（复用本站 Cloudflare Worker 房间协议）
 */
(function () {
  'use strict';

  var E = (typeof window !== 'undefined' ? window : globalThis).LiarEngine;
  var AI = (typeof window !== 'undefined' ? window : globalThis).LiarAI;
  var GameEngine = E.GameEngine;

  var AI_PLAYERS = [
    { id: 'a1', name: '酒鬼老莫', avatar: '♠', bot: true },
    { id: 'a2', name: '铁匠锤叔', avatar: '♣', bot: true },
    { id: 'a3', name: '神婆小娜', avatar: '♦', bot: true },
  ];

    // 我的昵称（登录账号）；未登录兜底「你」
  function myName() {
    return (window.Auth && window.Auth.user && String(window.Auth.user).trim())
      ? String(window.Auth.user).slice(0, 10) : '你';
  }
var app = {
    mode: 'none',            // none | solo | online
    engine: null,
    view: null,
    youId: 'you',
    room: null,
    ws: null,
    selected: new Set(),
    busy: false,
    paused: false,
    session: 0,
    aiTimer: null,
    introSeq: 0,
    introPlaying: false,
    handsHidden: true,   // 开局抽取阶段手牌不渲染（避免遮罩下隐约可见）
    revealSequence: 0,
    lastPropRound: -1,
    connectionTimer: null,
    roomStarted: false,
    profileActive: false,
    // 联机状态
    connOk: false,
    welcomed: false,
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    game: $('game'), lobby: $('lobby'),
    reveal: $('revealOverlay'), end: $('endOverlay'), rules: $('rulesOverlay'),
    tutorial: $('tutorialOverlay'), toast: $('toast'),
    players: $('players'), hand: $('hand'),
    targetRank: $('targetRank'), targetName: $('targetName'),
    roundNo: $('roundNo'), pileCount: $('pileCount'), claimText: $('claimText'),
    youLabel: $('youLabel'), connectionHint: $('connectionHint'),
    selectionHint: $('selectionHint'),
    challengeText: $('challengeText'),
    selectedCount: $('selectedCount'), pile: $('playedPile'),
    challenge: $('challengeBtn'), play: $('playBtn'),
    modeBadge: $('modeBadge'),
    continueBtn: $('continueBtn'), onlineContinue: $('onlineContinue'),
    shootChoices: $('shootChoices'), shootPrompt: $('shootPrompt'),
    shootSelfBtn: $('shootSelfBtn'), shootOtherBtn: $('shootOtherBtn'),
    restartBtn: $('restartBtn'), endLeaveBtn: $('endLeaveBtn'),
    revealed: $('revealedCards'), revealTitle: $('revealTitle'),
    revealEyebrow: $('revealEyebrow'), revealCopy: $('revealCopy'),
    roulette: $('roulette'), rouletteText: $('rouletteText'),
    eliminationImpact: $('eliminationImpact'), eliminationName: $('eliminationName'),
    endTitle: $('endTitle'), endCopy: $('endCopy'),
    tutorialTitle: $('tutorialTitle'), tutorialCopy: $('tutorialCopy'),
    tutorialProgress: $('tutorialProgress'), tutorialVisual: $('tutorialVisual'),
  };

  /* ---------- 工具 ---------- */
  // avatar 渲染：dataURI 图片 → <img>；花色字符 → 原文本
  function avatarHtml(av) {
    var s = String(av || '');
    if (s.indexOf('data:image/') === 0) return '<img class="liar-avatar-img" src="' + s + '" alt="">';
    return escapeHtml(s);
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function playerName(id) {
    if (!app.view) return id;
    var p = app.view.players.find(function (x) { return x.id === id; });
    return p ? p.name : id;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.hidden = true; }, 2400);
  }
  function focusSoon(el) { if (el && el.focus) setTimeout(function () { el.focus({ preventScroll: true }); }, 50); }

  /* ---------- 渲染 ---------- */
  function showGame() {
    els.lobby.hidden = true;
    els.reveal.hidden = true; els.end.hidden = true;
    els.game.hidden = false;
  }

  function render() {
    var view = app.view;
    if (!view) return;
    var me = view.players.find(function (p) { return p.id === app.youId; });
    var opponents = view.players.filter(function (p) { return p.id !== app.youId; });
    els.targetRank.textContent = view.target;
    els.targetName.textContent = E.CARD_NAMES[view.target];
    els.roundNo.textContent = view.round;
    els.pileCount.textContent = view.pileCount;
    view.lastPlayCount = view.lastPlay ? view.lastPlay.count : 0;
    els.claimText.textContent = '宣称是 ' + view.target;
    els.youLabel.textContent = me ? (me.name + ' · 你的手牌') : '旁观牌局';
    els.connectionHint.textContent = app.mode === 'online' ? ('房间 ' + (app.room ? app.room.code : '…')) : '单人模式';
    renderOpponents(opponents);
    renderHand(me, view);
    renderPile(view);
    renderHistory(view.history);
    renderControls(me, view);
    renderProps(view);
  }

  /* 桌上道具 ↔ 游戏状态联动：每个道具对应一个状态信号 */
  function propEl(name) {
    return document.querySelector('.liar-prop[data-prop="' + name + '"]');
  }
  function setProp(name, cls, on) {
    var el = propEl(name);
    if (el) el.classList.toggle(cls, !!on);
  }
  function bumpProp(name) {
    var el = propEl(name);
    if (!el) return;
    el.classList.remove('bump');
    void el.offsetWidth;          // 重排以重启动画
    el.classList.add('bump');
    setTimeout(function () { el.classList.remove('bump'); }, 900);
  }
  function renderProps(view) {
    if (!document.querySelector('.liar-props')) return;
    var myTurn = view.phase === 'playing' && view.current === app.youId;
    var shooting = view.phase === 'shooting';
    var canChallenge = myTurn && !!view.lastPlay && app.youId !== (view.lastPlay && view.lastPlay.player);
    // 🔫 左轮 ↔ 开枪阶段
    setProp('revolver', 'active', shooting);
    // 🔍 放大镜 ↔ 可质疑（轮到我 + 上家出过牌）
    setProp('lens', 'active', canChallenge);
    // 🕯️ 蜡烛 ↔ 我的回合
    setProp('candle', 'lit', myTurn);
    // ⛓️ 手铐 ↔ 有人手牌出尽（被"锁"住只能质疑）
    var anyEmpty = view.players.some(function (p) { return p.alive !== false && p.handCount === 0; });
    setProp('cuffs', 'active', anyEmpty);
    // 🚬 雪茄 ↔ 已淘汰人数（有人死 → 熄灭）
    var dead = view.players.filter(function (p) { return p.alive === false; }).length;
    setProp('cigar', 'doused', dead > 0);
    // 🍺 啤酒 ↔ 新一局（碰杯弹跳）
    if (app.lastPropRound !== view.round) {
      app.lastPropRound = view.round;
      if (view.round > 0) bumpProp('beer');
    }
  }

  function renderOpponents(opponents) {
    var view = app.view;
    els.players.innerHTML = opponents.map(function (player, index) {
      var cards = Array.from({ length: player.handCount }, function () { return '<i class="liar-mini-card"></i>'; }).join('');
      var chambers = Array.from({ length: 6 }, function (_, chamber) {
        return '<span class="' + (chamber < player.shots ? 'used' : '') + '"></span>';
      }).join('');
      var status = !player.connected ? '已断开连接'
        : !player.alive ? '已淘汰'
        : player.handCount ? (player.handCount + ' 张牌 · 弹巢 ' + player.shots + '/6')
        : ('手牌已出尽 · 弹巢 ' + player.shots + '/6');
      return '<article class="liar-opp ' + (!player.alive ? 'dead' : '') + ' ' + (view.current === player.id && view.phase === 'playing' ? 'active' : '') + '" data-seat="' + (index + 1) + '" data-total="' + opponents.length + '">' +
        '<div class="liar-avatar-ring"><div class="liar-avatar">' + avatarHtml(player.avatar) + '</div><i class="liar-turn-dot"></i></div>' +
        '<div class="liar-name">' + escapeHtml(player.name) + '</div>' +
        '<div class="liar-status">' + status + '</div>' +
        '<div class="liar-mini-cards">' + cards + '</div>' +
        '<div class="liar-chambers">' + chambers + '</div>' +
        '</article>';
    }).join('');
  }

  /* ---------- 快捷短语（只传代号 1/2/3，客户端映射文字） ---------- */
  var PHRASES = { 1: '有本事就质疑我！', 2: '质疑他！', 3: '干得漂亮' };

  // 在指定玩家头像旁冒出短语气泡（固定定位，挂到 body 级气泡层，不被舞台 overflow 裁剪）
  function showBubble(playerId, code) {
    var text = PHRASES[code];
    if (!text) return;
    var host = null;
    if (String(playerId) === String(app.youId)) {
      // 自己：冒在底部「你的手牌」标签旁
      host = els.youLabel;
    } else {
      // 对手：找对应座位卡片（按名字匹配）
      var opps = document.querySelectorAll('.liar-opp');
      var me = (app.view && app.view.players) ? app.view.players.filter(function (p) { return String(p.id) === String(playerId); })[0] : null;
      var name = me ? me.name : '';
      for (var i = 0; i < opps.length; i++) {
        var el = opps[i];
        if (!name || (el.textContent || '').indexOf(name) >= 0) { host = el; break; }
      }
    }
    if (!host || !host.getBoundingClientRect) return;
    var rect = host.getBoundingClientRect();
    var layer = document.getElementById('liarBubbleLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'liarBubbleLayer';
      layer.className = 'liar-bubble-layer';
      document.body.appendChild(layer);
    }
    var bub = document.createElement('span');
    bub.className = 'liar-bubble';
    bub.textContent = text;
    // 固定在头像/标签上方居中，尾巴朝下指向头像
    bub.style.left = (rect.left + rect.width / 2) + 'px';
    bub.style.top = (rect.top - 8) + 'px';
    layer.appendChild(bub);
    setTimeout(function () { if (bub && bub.parentNode) bub.parentNode.removeChild(bub); }, 2700);
  }

  // 发送短语：联机走服务端转发代号（气泡由广播统一回显，含自己，避免重复）；
  // 单人本地直接冒出
  function sendPhrase(code) {
    if (app.mode === 'online') {
      sendOnline({ type: 'phrase', code: parseInt(code, 10) });
    } else {
      showBubble(app.youId, code);
    }
  }

  // 绑定聊天按钮与快捷短语面板
  function bindChat() {
    var btn = document.getElementById('chatBtn');
    var panel = document.getElementById('liarQuick');
    if (!btn || !panel) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
    });
    document.addEventListener('click', function () { if (!panel.hidden) panel.hidden = true; });
    panel.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.liar-quick-item') : null;
      if (!item) return;
      e.stopPropagation();
      panel.hidden = true;
      sendPhrase(item.getAttribute('data-code'));
    });
  }

  // 开局动画（严格串行）：① 先手轮盘(4s) → ② 真实牌桌轮流发牌 → ③ 底牌轮盘
  function sleepMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function buildPlayerCards() {
    if (!app.view || !app.view.players) return [];
    return app.view.players.map(function (p) {
      return {
        id: p.id, name: p.name || '玩家', avatar: p.avatar || '♠',
        alive: p.alive !== false, isMe: p.id === app.youId,
      };
    });
  }

  /* 阶段1：先手轮盘（玩家卡片逐个高亮→减速→停一人，总时长 4s） */
  async function roulettePick(cards) {
    var wheels = document.getElementById('introWheels');
    var phase = document.getElementById('introPhase');
    if (!wheels) return null;
    var alive = cards.filter(function (c) { return c.alive; });
    if (!alive.length) alive = cards;
    wheels.hidden = false;
    wheels.innerHTML = alive.map(function (c) {
      return '<div class="intro-pcard" data-id="' + c.id + '">' +
        '<span class="intro-pavatar">' + escapeHtml(c.avatar) + '</span>' +
        '<span class="intro-pname">' + escapeHtml(c.name) + '</span>' +
        '</div>';
    }).join('');
    var els = Array.prototype.slice.call(wheels.querySelectorAll('.intro-pcard'));
    if (!els.length) return null;
    // 停在引擎真正的先手（app.view.current），保证显示与实际一致
    var pickIdx = 0;
    var realFirst = app.view.current;
    for (var fi = 0; fi < alive.length; fi++) { if (alive[fi].id === realFirst) { pickIdx = fi; break; } }
    var DURATION = 4000;            // 固定 4 秒
    var delay = 70;
    var idx = 0, elapsed = 0;
    phase.textContent = '🎲 决定先手';
    while (elapsed < DURATION) {
      els.forEach(function (el) { el.classList.remove('active'); });
      els[idx].classList.add('active');
      await sleepMs(delay);
      elapsed += delay;
      delay = Math.min(360, delay + 18);   // 减速
      idx = (idx + 1) % els.length;
    }
    // 停在目标
    els.forEach(function (el) { el.classList.remove('active'); });
    els[pickIdx].classList.add('active');
    var winner = alive[pickIdx];
    phase.textContent = '🎯 先手';
    var main = document.getElementById('introMain');
    if (main) main.textContent = (winner.isMe ? myName() : winner.name) + ' 先出牌';
    els[pickIdx].classList.add('winner');
    await sleepMs(1200);
    wheels.hidden = true;
    return winner;
  }

  /* 阶段2：真实牌桌轮流发牌（无独立窗口，牌直接从中央牌桌飞向座位） */
  async function dealAnimation(cards) {
    var deal = document.getElementById('introDeal');
    var phase = document.getElementById('introPhase');
    if (!deal) return;
    phase.textContent = '🂠 发牌';
    var main = document.getElementById('introMain');
    if (main) main.textContent = '';
    var players = cards.filter(function (c) { return c.alive; });
    if (!players.length) players = cards;
    // 发牌源 = 牌桌中央（liar-center 位置）
    var centerEl = document.querySelector('.liar-center');
    var srcRect = centerEl ? centerEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    var srcX = srcRect.left + srcRect.width / 2, srcY = srcRect.top + srcRect.height / 2;
    var handEl = document.getElementById('hand');
    var oppEls = Array.prototype.slice.call(document.querySelectorAll('.liar-opp'));
    function targetFor(p, roundIdx) {
      if (p.isMe) {
        var hr = handEl.getBoundingClientRect();
        return { x: hr.left + hr.width / 2 + (roundIdx - 2) * 28, y: hr.top + 40 };
      }
      var opp = oppEls.find(function (el) { return el.textContent.indexOf(p.name) >= 0; });
      if (opp) { var r = opp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      return { x: srcX, y: srcY };
    }
    var ROUNDS = 5;
    deal.hidden = false;
    for (var r = 0; r < ROUNDS; r++) {
      for (var pi = 0; pi < players.length; pi++) {
        var p = players[pi];
        var t = targetFor(p, r);
        var card = document.createElement('i');
        card.className = 'intro-fly-card';
        card.style.left = srcX + 'px';
        card.style.top = srcY + 'px';
        card.style.transform = 'translate(0,0) rotate(0deg) scale(1)';
        deal.appendChild(card);
        void card.offsetWidth;   // 强制回流
        card.style.transform = 'translate(' + (t.x - srcX) + 'px,' + (t.y - srcY) + 'px) rotate(' + (Math.random() * 24 - 12) + 'deg) scale(0.6)';
        card.style.opacity = '0';
        await sleepMs(140);
        setTimeout(function (c) { if (c && c.parentNode) c.parentNode.removeChild(c); }, 450);
      }
    }
    await sleepMs(200);
    deal.hidden = true;
  }

  /* 阶段3：底牌轮盘（A/K/Q 三张卡片高亮循环→停目标→展示） */
  async function revealTarget() {
    var reveal = document.getElementById('introReveal');
    var phase = document.getElementById('introPhase');
    if (!reveal) return;
    phase.textContent = '🃏 底牌';
    var bcards = document.getElementById('introBcards');
    var cardEls = bcards ? Array.prototype.slice.call(bcards.querySelectorAll('.intro-bcard')) : [];
    var target = app.view.target || 'K';
    reveal.hidden = false;
    if (cardEls.length) {
      // 每局都从 A/K/Q 三张公平重抽：先清掉上局 winner/active 高亮残留
      cardEls.forEach(function (el) { el.classList.remove('active', 'winner'); });
      // 从随机位置起跳，避免每局看起来一样
      var idx = Math.floor(Math.random() * cardEls.length), delay = 90, elapsed = 0, DURATION = 1800;
      while (elapsed < DURATION) {
        cardEls.forEach(function (el) { el.classList.remove('active'); });
        cardEls[idx].classList.add('active');
        await sleepMs(delay);
        elapsed += delay;
        delay = Math.min(300, delay + 22);
        idx = (idx + 1) % cardEls.length;
      }
      // 停在目标
      var targetEl = cardEls.find(function (el) { return el.dataset.rank === target; }) || cardEls[0];
      cardEls.forEach(function (el) { el.classList.remove('active'); });
      targetEl.classList.add('winner');
    }
    var main = document.getElementById('introMain');
    if (main) main.textContent = '本局指定 ' + target + '（' + (E.CARD_NAMES[target] || '') + '）';
    await sleepMs(2200);
    reveal.hidden = true;
  }

  async function playIntro() {
    if (!app.view) return;
    var intro = document.getElementById('introOverlay');
    if (!intro) return;
    app.handsHidden = true;            // 抽取阶段一律先藏手牌
    els.hand.classList.remove('dealing');
    var seq = ++app.introSeq;
    intro.hidden = false;
    try {
      var cards = buildPlayerCards();
      await roulettePick(cards);           // ① 先手轮盘（全程手牌隐藏）
      if (seq !== app.introSeq) return;
      await revealTarget();                // ② 底牌轮盘（本局指定牌）
      if (seq !== app.introSeq) return;
      await sleepMs(900);                  // ③ 底牌后小停顿
      if (seq !== app.introSeq) return;
      // ④ 收遮罩 → 手牌一张张从底部冒出（~2 秒播完）
      intro.hidden = true;
      app.handsHidden = false;
      els.hand.classList.add('dealing');   // 触发逐张浮出动画
      render();
      setTimeout(function () { els.hand.classList.remove('dealing'); }, 2200);
    } catch (e) {
      intro.hidden = true;
      app.handsHidden = false;
    }
  }

  function renderHand(me, view) {
    if (app.handsHidden) { els.hand.innerHTML = ''; return; }   // 抽取阶段不露手牌
    var hand = (me && me.hand) || [];
    var myTurn = view.current === app.youId && view.phase === 'playing' && !app.busy && !app.paused && me && me.alive;
    var dealing = els.hand.classList.contains('dealing');
    els.hand.innerHTML = hand.map(function (rank, index) {
      var selected = app.selected.has(index);
      var red = rank === 'Q' ? 'red' : '';
      var rotation = (index - (hand.length - 1) / 2) * 3;
      return '<button class="liar-card ' + (rank === E.WILD_CARD ? 'joker' : '') + ' ' + red + ' ' + (selected ? 'selected' : '') + ' ' + (dealing ? 'dealing' : '') + '" type="button" data-index="' + index + '" style="--rot:' + rotation + 'deg;--d:' + (index * 300) + 'ms" aria-pressed="' + selected + '" ' + (myTurn ? '' : 'disabled') + '>' +
        '<span class="liar-corner">' + (rank === E.WILD_CARD ? '★' : rank) + '</span>' +
        '<span class="liar-suit">' + (rank === 'Q' ? '♥' : rank === 'K' ? '♣' : rank === 'A' ? '♠' : '✦') + '</span>' +
        '<span class="liar-face">' + (rank === E.WILD_CARD ? 'J' : rank) + '</span>' +
        (rank === E.WILD_CARD ? '<small class="liar-wild-label">万能</small>' : '') +
        '</button>';
    }).join('');
    els.hand.querySelectorAll('.liar-card').forEach(function (card) {
      card.addEventListener('click', function (e) { toggleCard(Number(card.dataset.index)); });
    });
  }

  var lastPileCount = -1;   // 上次桌面牌数（检测新增牌做飞入动画）
  var lastPileRound = -1;
  function renderPile(view) {
    var count = view.pileCount;
    if (!count) { lastPileCount = -1; els.pile.innerHTML = '<div class="liar-empty">等待出牌</div>'; return; }
    var visible = Math.min(count, 9);
    var sameRound = lastPileRound === view.round;
    var arriving = sameRound ? Math.max(0, count - lastPileCount) : count;
    if (arriving < 0) arriving = 0;
    lastPileCount = count;
    lastPileRound = view.round;
    var fromOpponent = view.lastPlay && view.lastPlay.player !== app.youId;
    var arrivalStart = Math.max(0, visible - arriving);
    // 出牌起始位置：自己出牌从底部手牌区，对手出牌从对手座位旁（动态定位）
    var flyFrom = { x: 0, y: 150 };
    if (fromOpponent && view.lastPlay) {
      var oppName = playerName(view.lastPlay.player);
      var oppEl = null;
      var opps = document.querySelectorAll('.liar-opp');
      for (var oi = 0; oi < opps.length; oi++) {
        if (opps[oi].textContent.indexOf(oppName) >= 0) { oppEl = opps[oi]; break; }
      }
      if (oppEl) {
        var r = oppEl.getBoundingClientRect();
        flyFrom = { x: r.left + r.width / 2 - window.innerWidth / 2, y: r.top + r.height / 2 - window.innerHeight / 2 };
      }
    }
    var cards = Array.from({ length: visible }, function (_, index) {
      var rotation = (index * 23 % 34) - 17;
      var offset = (index - (visible - 1) / 2) * 5;
      var isArriving = index >= arrivalStart;
      var origin = fromOpponent ? 'from-opp' : 'from-you';
      var delay = isArriving ? (index - arrivalStart) * 80 : 0;
      return '<i class="liar-pile-card' + (isArriving ? ' arriving ' + origin : '') + '" style="--x:' + offset + 'px;--r:' + rotation + 'deg;--d:' + delay + 'ms;--fx:' + flyFrom.x + 'px;--fy:' + flyFrom.y + 'px"></i>';
    }).join('');
    var actor = view.lastPlay ? playerName(view.lastPlay.player) : '上一位玩家';
    els.pile.innerHTML = cards;    // 桌面只有反扣牌（徽标已删，出牌信息走顶部通知）
    // 出牌横幅（顶部通知，开局动画期间不弹）
    if (arriving > 0 && view.lastPlay && window.Notify && !app.introPlaying) {
      window.Notify.show(actor + ' 宣称打出 ' + view.lastPlay.count + ' 张 ' + view.target, 'info', { ttl: 3000 });
    }
  }

  var lastNotified = -1;    // 已通知的历史条目标志（避免重复弹横幅）
  function renderHistory(history) {
    if (!history || !history.length) return;
    if (app.introPlaying) return;    // 开局动画期间不弹（先手/发牌/底牌还没结束）
    // 酒馆耳语 → 顶部横幅通知（对齐其他游戏 notify 样式）
    if (history.length > lastNotified && window.Notify) {
      for (var i = lastNotified; i < history.length; i++) {
        var entry = history[i];
        if (/淘汰|击发|成为最后的赢家/.test(entry)) {
          window.Notify.show(entry, 'error', { ttl: 4000 });
        } else if (/质疑/.test(entry)) {
          window.Notify.show(entry, 'warn', { ttl: 3500 });
        } else {
          window.Notify.show(entry, 'info', { ttl: 3000 });
        }
      }
      lastNotified = history.length;
    }
  }

  var lastTurnId = null;   // 上次回合通知的玩家（防止每帧刷通知）
  var lastPhaseMsg = '';
  function renderControls(me, view) {
    var myTurn = Boolean(me && me.alive && view.current === app.youId && view.phase === 'playing' && !app.busy && !app.paused);
    els.selectedCount.textContent = app.selected.size;
    var previous = view.lastPlay ? view.players.find(function (p) { return p.id === view.lastPlay.player; }) : null;
    els.selectionHint.textContent = app.selected.size
      ? ('已选择 ' + app.selected.size + ' 张 · 将宣称为 ' + view.target)
      : myTurn ? (!me.handCount && view.lastPlay ? '手牌已出尽，只能质疑上一手' : (view.lastPlay ? '继续出牌，或质疑上一手' : '选择 1–3 张牌'))
      : (me && me.alive) ? '等待出牌' : '你已被淘汰，正在旁观';
    els.play.disabled = !myTurn || app.selected.size < 1 || app.selected.size > 3;
    // 质疑按钮只在「轮到我 + 桌上有上一手可质疑」时才显示，否则隐藏
    var canChallenge = myTurn && !!view.lastPlay;
    els.challenge.disabled = !canChallenge;
    els.challenge.style.display = canChallenge ? '' : 'none';
    if (view.lastPlay && previous) {
      els.challengeText.innerHTML = '揭穿 ' + escapeHtml(previous.name) + ' 的 <em>' + view.lastPlay.count + ' 张牌</em>';
    } else {
      els.challengeText.textContent = '尚无可质疑出牌';
    }
    // 「轮到/等待」只走顶部通知（状态变化时弹一次，不占桌面空间）
    var current = view.players.find(function (p) { return p.id === view.current; });
    if (view.phase === 'playing' && window.Notify && !app.busy && !app.paused && !app.introPlaying) {
      var turnKey = view.current + '|' + view.lastPlayCount;
      if (myTurn && lastTurnId !== 'me-' + turnKey) {
        lastTurnId = 'me-' + turnKey;
        window.Notify.show('轮到你了！', 'info', { ttl: 2500 });
      } else if (!myTurn && lastTurnId !== view.current + '|' + turnKey) {
        lastTurnId = view.current + '|' + turnKey;
        if (current && current.bot) window.Notify.show((current.name) + ' 的回合…', 'info', { ttl: 2000 });
      }
    }
    els.modeBadge.className = 'liar-badge ' + (app.mode === 'online' ? 'online' : app.mode === 'solo' ? 'solo' : '');
    els.modeBadge.querySelector('span').textContent = app.mode === 'online' ? ('联机 · ' + (app.room ? app.room.code : '')) : app.mode === 'solo' ? '单人牌局' : '未入座';
  }

  function toggleCard(index) {
    if (app.selected.has(index)) app.selected.delete(index);
    else if (app.selected.size < 3) app.selected.add(index);
    else return toast('一次最多打出 3 张牌');
    render();
  }

  /* ---------- 单人模式 ---------- */
  function startSolo() {
    app.session += 1;
    clearTimeout(app.aiTimer);
    lastNotified = 0;
    app.mode = 'solo';
    var bk = document.getElementById('backToGameBtn');
    if (bk) bk.textContent = '← 返回';    // AI 单人模式：显示「返回」
    app.youId = 'you';
    app.room = null;
    app.selected.clear();
    app.busy = false;
    app.paused = false;
    app.engine = new GameEngine([{ id: 'you', name: myName(), avatar: '♠' }].concat(AI_PLAYERS));
    app.engine.start();
    app.handsHidden = true;               // 开局抽取阶段不露手牌
    app.introPlaying = true;
    showGame();
    refreshLocal();
    app.introPlaying = true;
    playIntro().then(function () {
      app.introPlaying = false;
      maybeRunAI();
    });
  }

  function refreshLocal() {
    var prevCurrent = app.view ? app.view.current : null;
    app.view = app.engine.viewFor(app.youId);
    app.busy = app.view.phase !== 'playing';
    render();
    if (app.view.phase === 'ended') showEnd();
    else if (prevCurrent && app.view.current === app.youId && app.view.phase === 'playing' && app.mode === 'solo') maybeRunAI();
  }

  function maybeRunAI() {
    clearTimeout(app.aiTimer);
    if (app.introPlaying || app.mode !== 'solo' || app.paused || app.busy || !app.engine || app.engine.phase !== 'playing') return;
    var current = app.engine.player(app.engine.current);
    if (!current.bot) return;
    var session = app.session;
    var currentId = current.id;
    app.aiTimer = setTimeout(function () {
      setTimeout(async function () {
        if (session !== app.session || app.paused || app.busy || !app.engine || app.engine.current !== currentId || app.engine.phase !== 'playing') return;
        // AI 回合：不管质疑还是出牌，先统一显示「正在考虑…」（模拟真人读牌）
        var aiName = app.engine.player(currentId).name;
        app.view = app.engine.viewFor(app.youId);
        render();
        if (window.Notify) window.Notify.show(aiName + ' 正在考虑…', 'info', { ttl: 2200 });
        await sleepMs(1300);   // 考虑时间
        if (session !== app.session || app.paused || app.busy || !app.engine || app.engine.current !== currentId) return;
        if (app.engine.lastPlay && AI.shouldChallenge(app.engine, currentId)) {
          // 决定质疑：再盯一眼（顺便甩一句短语，从它头像旁冒出）
          if (window.Notify) window.Notify.show(aiName + ' 决定质疑！', 'warn', { ttl: 1800 });
          showBubble(currentId, 2);
          await sleepMs(700);
          if (session !== app.session || app.paused || app.busy || !app.engine || app.engine.current !== currentId) return;
          localChallenge(currentId);
          return;
        }
        // 决定出牌
        app.engine.play(currentId, AI.chooseAI(app.engine, currentId));
        refreshLocal();
        maybeRunAI();
      }, 2000 + Math.random() * 1000);   // 模拟真人：至少 2 秒再动
    }, 200);
  }

  async function localChallenge(challenger) {
    var result = app.engine.challenge(challenger);
    await showReveal(result, false);
    refreshLocal();
    if (app.engine.phase === 'reveal' && !app.engine.reveal.pending) continueLocal();
  }

  async function showReveal(result, online) {
    var sequence = ++app.revealSequence;
    app.paused = false;
    els.reveal.hidden = false;
    els.continueBtn.hidden = true;
    els.onlineContinue.hidden = !online;
    els.eliminationImpact.hidden = true;
    els.revealed.innerHTML = '';
    els.roulette.className = 'liar-roulette';
    els.shootChoices.hidden = true;                 // 默认隐藏开枪按钮
    els.revealTitle.textContent = result.lied ? '谎言被揭穿' : '质疑失败';
    els.revealEyebrow.textContent = playerName(result.challenger) + ' 发起质疑';
    els.revealed.innerHTML = result.cards.map(function (card) {
      return '<div class="liar-reveal-card ' + (card === E.WILD_CARD ? 'joker' : '') + '">' + (card === E.WILD_CARD ? '★' : card) + '</div>';
    }).join('');
    var loserName = playerName(result.loser);
    var accusedName = playerName(result.accused);
    els.revealCopy.textContent = result.lied
      ? (accusedName + ' 宣称的牌里藏着假牌，谎言被识破！')
      : (accusedName + ' 说的是真话，' + loserName + ' 误判了。');
    // 左轮动画（转轮 + 已用弹巢）
    var chambers = els.roulette.querySelectorAll('.liar-chamber span');
    els.rouletteText.textContent = '左轮转动……';
    els.roulette.classList.add('spin');
    await sleep(650);
    var shotsAfter = result.shotsAfter != null ? result.shotsAfter : 0;
    chambers.forEach(function (c, i2) { c.className = i2 < shotsAfter ? 'used' : ''; });
    if (result.bang) {
      els.rouletteText.textContent = '💥 击发了！';
      await sleep(600);
      var victimName = playerName(result.victim != null ? result.victim : result.loser);
      showEliminationImpact(victimName);
      await sleep(1600);
    } else {
      els.rouletteText.textContent = '咔哒……空膛';
      await sleep(500);
    }
    if (sequence !== app.revealSequence) return;
    // 我是否该开枪？
    var myTurn = result.shooter != null && result.shooter === app.youId;
    if (online) {
      // 联机：我开枪 → 显示按钮；否则等待对方开枪（服务端会推送下一状态）
      els.shootChoices.hidden = !myTurn;
      if (myTurn) els.shootPrompt.textContent = '轮到你开枪：' + (result.bang === false && result.victim === app.youId ? '（你活过了这一枪）' : '');
      if (!myTurn) {
        els.onlineContinue.hidden = false;
        await sleep(2200);
        els.reveal.hidden = true;     // 等对方开枪时先收弹窗，服务端推送后再开
      }
    } else {
      // 本地/AI：只有我的开枪权才给按钮；AI 开枪自动决策
      if (myTurn) {
        els.shootChoices.hidden = false;
        els.shootPrompt.textContent = '轮到你开枪：' + (result.bang === false && result.victim === app.youId ? '你活过了这一枪，再选一次方向' : '选择开枪方向');
      } else if (result.shooter != null) {
        // AI 开枪：自动决策（朝对方优先，朝自己赌空弹其次——用 AI 简单策略）
        await sleep(800);
        var aiTarget = (Math.random() < 0.6) ? 'other' : 'self';
        // 记录本次 shoot 结果以驱动下一轮
        doLocalShoot(result.shooter, aiTarget, sequence);
      } else {
        // 无人需要开枪 → 进入下一局
        els.continueBtn.hidden = false;
      }
    }
  }

  // 本地开枪（含 AI 自动开枪）
  async function doLocalShoot(shooter, target, sequence) {
    var seq = sequence || ++app.revealSequence;
    els.shootChoices.hidden = true;
    var result;
    try {
      result = app.engine.shoot(shooter, target);
    } catch (e) {
      if (window.Notify) window.Notify.show(e.message || '开枪失败', 'error');
      els.reveal.hidden = true;
      refreshLocal();
      return;
    }
    app.view = app.engine.viewFor(app.youId);
    render();
    if (seq !== app.revealSequence) return;
    // 动画
    els.rouletteText.textContent = '扣动扳机……';
    els.roulette.className = 'liar-roulette spin';
    await sleep(600);
    var chambers = els.roulette.querySelectorAll('.liar-chamber span');
    var shotsAfter = result.shotsAfter != null ? result.shotsAfter : 0;
    chambers.forEach(function (c, i2) { c.className = i2 < shotsAfter ? 'used' : ''; });
    els.rouletteText.textContent = result.bang ? '💥 击发了！' : '咔哒……空膛';
    if (result.bang) {
      await sleep(600);
      var victimName = playerName(result.victim != null ? result.victim : shooter);
      showEliminationImpact(victimName);
      await sleep(1500);
    } else {
      await sleep(500);
    }
    // 整局结束？
    if (app.engine.phase === 'ended') {
      els.reveal.hidden = true;
      els.eliminationImpact.hidden = true;
      app.busy = true;
      refreshLocal();
      return;
    }
    if (seq !== app.revealSequence) return;
    // 继续下一开枪者
    if (result.shooter != null && result.shooter === app.youId) {
      // 又轮到我（朝自己空弹再开 / 对方空弹后轮到我）
      els.shootChoices.hidden = false;
      els.shootPrompt.textContent = (result.bang === false && result.victim === app.youId) ? '你活下来了，再开一枪' : '轮到你开枪';
    } else if (result.shooter != null) {
      // AI 继续开枪
      await sleep(800);
      var ai2 = (Math.random() < 0.6) ? 'other' : 'self';
      doLocalShoot(result.shooter, ai2, seq);
    } else {
      els.continueBtn.hidden = false;   // 无人开枪 → 下一局
    }
  }

  // 联机开枪结果：动画 + 更新弹窗给下一开枪者
  async function playOnlineShoot(result) {
    var seq = ++app.revealSequence;
    els.shootChoices.hidden = true;
    var chambers = els.roulette.querySelectorAll('.liar-chamber span');
    els.rouletteText.textContent = '扣动扳机……';
    els.roulette.className = 'liar-roulette spin';
    await sleep(600);
    var shotsAfter = result.shotsAfter != null ? result.shotsAfter : 0;
    chambers.forEach(function (c, i2) { c.className = i2 < shotsAfter ? 'used' : ''; });
    els.rouletteText.textContent = result.bang ? '💥 击发了！' : '咔哒……空膛';
    if (result.bang) {
      await sleep(600);
      var victimName = playerName(result.victim != null ? result.victim : app.youId);
      showEliminationImpact(victimName);
      await sleep(1500);
    } else {
      await sleep(500);
    }
    if (seq !== app.revealSequence) return;
    // 局面状态
    var ph = app.view && app.view.phase;
    if (ph === 'ended') {
      els.reveal.hidden = true;
      els.eliminationImpact.hidden = true;
      showEnd();
      return;
    }
    // 下一开枪者：我 → 显示按钮；对方 → 等待服务端推送；无人 → 下一局
    var myTurn = result.shooter != null && result.shooter === app.youId;
    if (result.shooter != null) {
      els.shootChoices.hidden = !myTurn;
      if (myTurn) els.shootPrompt.textContent = '轮到你开枪';
    } else {
      els.reveal.hidden = true;          // 开枪结束 → 等服务端推送下一局
    }
  }

  // 开枪按钮绑定（本地直接引擎；联机发消息）
  function bindShootButtons() {
    if (els.shootSelfBtn) els.shootSelfBtn.addEventListener('click', function () {
      els.shootChoices.hidden = true;
      if (app.mode === 'solo') doLocalShoot(app.youId, 'self');
      else if (app.mode === 'online') sendOnline({ type: 'shoot', target: 'self' });
    });
    if (els.shootOtherBtn) els.shootOtherBtn.addEventListener('click', function () {
      els.shootChoices.hidden = true;
      if (app.mode === 'solo') doLocalShoot(app.youId, 'other');
      else if (app.mode === 'online') sendOnline({ type: 'shoot', target: 'other' });
    });
  }
  function showEliminationImpact(name) {
    els.eliminationName.textContent = name;
    els.eliminationImpact.hidden = false;
    setTimeout(function () { els.eliminationImpact.hidden = true; }, 1600);
  }

  function continueLocal() {
    if (!app.engine || app.engine.phase !== 'reveal') return;
    app.engine.nextRound();
    app.selected.clear();
    app.busy = app.engine.phase !== 'playing';
    app.view = app.engine.viewFor(app.youId);
    els.reveal.hidden = true;              // 关闭质疑弹窗
    render();
    // 只剩一人 → 直接结束（不再发牌！）
    var aliveNow = app.engine.alivePlayers ? app.engine.alivePlayers().length : 0;
    if (app.engine.phase === 'ended' || aliveNow <= 1) {
      showEnd();
      return;
    }
    app.introPlaying = true;
    playIntro().then(function () {
      app.introPlaying = false;
      maybeRunAI();
    });
  }

  function playSelected() {
    if (app.mode === 'solo') {
      if (app.busy || !app.selected.size) return;
      var indices = Array.from(app.selected).sort(function (a, b) { return b - a; });
      try {
        app.engine.play(app.youId, indices);
      } catch (e) { return toast(e.message || '出牌失败'); }
      app.selected.clear();
      refreshLocal();
      maybeRunAI();
    } else if (app.mode === 'online') {
      if (app.busy || !app.selected.size || !app.connOk) return;
      sendOnline({ type: 'play', indices: Array.from(app.selected).sort(function (a, b) { return a - b; }) });
      app.selected.clear();
      render();
    }
  }

  function challenge() {
    if (app.mode === 'solo') {
      if (app.busy || !app.engine.lastPlay) return;
      localChallenge(app.youId);
    } else if (app.mode === 'online') {
      if (app.busy || !app.connOk) return;
      sendOnline({ type: 'challenge' });
      app.selected.clear();
      render();
    }
  }

  function showEnd() {
    var winner = app.view.players.find(function (p) { return p.id === app.view.winner; });
    var won = winner && winner.id === app.youId;
    var wname = winner ? winner.name : '无人';
    els.endTitle.textContent = won ? '🏆 你成为冠军！' : ('🏆 ' + wname + ' 夺冠');
    els.endCopy.textContent = app.mode === 'online' ? ('酒馆最后的赢家是 ' + wname + '。') : (won ? '三名酒客都倒下了，只有你站着。' : '下次胆子大一点，' + wname + ' 赢下了今晚。');
    // 冠军横幅（顶部通知，4 秒）
    if (window.Notify) window.Notify.show('🏆 仅剩 1 人，游戏结束', 'win', { ttl: 4000 });
    els.endLeaveBtn.hidden = app.mode !== 'online';
    els.end.hidden = false;
    showResultOverlay(winner);
  }

  /* 统一结算覆盖层（ResultOverlay）：冠军 + 出局顺序排位 */
  function showResultOverlay(winner) {
    if (!window.ResultOverlay) return;
    var ps = (app.view && app.view.players) || [];
    if (!ps.length) return;
    var me = ps.find(function (p) { return p.id === app.youId; });
    var meName = me ? me.name : myName();
    var won = !!(winner && winner.id === app.youId);
    // 排位：冠军第一，其余存活者在前、已淘汰按原序
    var ordered = ps.slice().sort(function (a, b) {
      var aw = (a.id === (winner && winner.id)) ? 0 : 1;
      var bw = (b.id === (winner && winner.id)) ? 0 : 1;
      if (aw !== bw) return aw - bw;
      var aa = a.alive === false ? 1 : 0, ba = b.alive === false ? 1 : 0;
      return aa - ba;
    });
    var total = ordered.length;
    var players = ordered.map(function (p, i) {
      return {
        name: p.name + (p.id === app.youId ? '（我）' : ''),
        score: String(total - i),                 // 名次分：冠军=人数
        tag: (p.id === (winner && winner.id)) ? '冠军 · 活到最后' : (p.alive === false ? '已出局' : '存活')
      };
    });
    var meIdx = 0;
    for (var k = 0; k < ordered.length; k++) if (ordered[k].id === app.youId) meIdx = k;
    var round = (app.view && app.view.roundNo != null) ? app.view.roundNo : '';
    var stats = [['酒客', total + ' 人'], ['轮次', round ? round + ' 轮' : '—'], ['冠军', winner ? winner.name : '无人']];
    ResultOverlay.show({
      game: '骗子酒馆',
      title: won ? '🏆 你成为冠军！' : '🏆 ' + (winner ? winner.name : '无人') + ' 夺冠',
      sub: won ? '三名酒客都倒下了，只有你站着' : '酒馆最后的赢家是 ' + (winner ? winner.name : '无人'),
      meRank: meIdx + 1,
      me: { name: meName, score: String(total - meIdx), tag: won ? '冠军 · 活到最后' : (me && me.alive === false ? '已出局' : '存活') },
      players: players,
      stats: stats
    });
  }

  /* ---------- 联机（复用 CF Worker 房间） ---------- */
  var WS_BASE = 'wss://quoridor-mp.pages.dev/api/room/';   // 注意：WS 端点需带 /ws 后缀（见 openSocket）
  var HTTP_BASE = 'https://quoridor-mp.pages.dev/api/room';

  function connectRoom(code, host) {
    // 昵称：优先登录账号昵称（window.Auth.user），其次 URL ?name=（分享/大厅带入），最后随机「酒客·XX」
    var qn = {};
    (location.search || '').replace(/[?&]([^=&]+)=([^&]*)/g, function (_, k, v) { qn[k] = v; });
    var name = (window.Auth && window.Auth.user && String(window.Auth.user).trim())
      ? String(window.Auth.user).slice(0, 10)
      : ((qn.name && String(qn.name).trim()) ? String(qn.name).slice(0, 10) : ('酒客·' + Math.floor(10 + Math.random() * 90)));
    openSocket(code, name, host);
  }

  function openSocket(code, name, host) {
    app.mode = 'online';
    app.room = { code: code, host: host };
    app._reconnectAttempts = 0;
    app._reconnectTimer = null;
    app._intentionalClose = false;
    var bk = document.getElementById('backToGameBtn');
    if (bk) bk.textContent = '← 返回';   // 联机模式：显示「返回房间」
    // 统一等待室（GameLobby 组件，对齐其余游戏）
    app.lobby = new window.GameLobby({
      onReady: function () { sendOnline({ type: 'ready' }); },
      onStart: function () { sendOnline({ type: 'start' }); },
      onNotify: function () { sendOnline({ type: 'notify' }); },
      onLeave: function () { if (app.ws) app.ws.close(); app._intentionalClose = true; location.href = 'liar.html'; },
      onAddAI: function (i) { sendOnline({ type: 'add_ai', slot: i }); },
      onRemoveAI: function (i) { sendOnline({ type: 'remove_ai', slot: i }); },
    });
    app.lobby.setCapacity(4);          // 骗子酒馆 2-4 人
    app.lobby.setMinToStart(2);       // 至少 2 人即可开局（不强制满 4）
    app.lobby.show(code);
    app.lobby.setStatus('已连接，等待准备开始', 'connected');
    setChatVisible(false);   // 房间页隐藏快捷短语按钮（仅对局中显示）
    openWsInner(code, name, host);
  }

  function openWsInner(code, name, host) {
    if (app._intentionalClose) return;
    var ws = new WebSocket(WS_BASE + encodeURIComponent(code) + '/ws');
    app.ws = ws;
    ws.onopen = function () {
      app._reconnectAttempts = 0;
      ws.send(JSON.stringify({ type: 'hello', name: name }));
      app.playerName = name;
      // 心跳：每 15s 发 ping，避免服务端 30s 无消息判定死连接而被误杀（骗子酒馆掉线根因）
      if (app._hb) clearInterval(app._hb);
      app._hb = setInterval(function () { sendOnline({ type: 'ping' }); }, 15000);
      if (window.Notify) window.Notify.clear('📡 正在重连…');
    };
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      handleOnlineMessage(msg);
    };
    ws.onclose = function () {
      app.connOk = false;
      if (app._hb) { clearInterval(app._hb); app._hb = null; }
      if (app._intentionalClose || app.mode !== 'online') return;
      scheduleReconnect(code, name, host);
    };
    ws.onerror = function () { /* onclose 会接手重连 */ };
  }

  // 指数退避自动重连（对齐 gd/uno：base 1s ×2^n，封顶 30s，最多 8 次后放弃）
  function scheduleReconnect(code, name, host) {
    if (app._intentionalClose || app.mode !== 'online') return;
    if (app._reconnectAttempts >= 8) {
      if (window.Notify) window.Notify.show('多次重连失败，请刷新重试', 'error', { sticky: true });
      return;
    }
    app._reconnectAttempts++;
    var delay = Math.min(30000, 1000 * Math.pow(2, app._reconnectAttempts - 1));
    if (window.Notify) window.Notify.show('连接中断，' + Math.round(delay / 1000) + 's 后第 ' + app._reconnectAttempts + ' 次重连…', 'warn', { sticky: true });
    if (app._reconnectTimer) clearTimeout(app._reconnectTimer);
    app._reconnectTimer = setTimeout(function () { openWsInner(code, name, host); }, delay);
  }

  function sendOnline(message) {
    if (app.ws && app.ws.readyState === 1) app.ws.send(JSON.stringify(message));
  }

  // 快捷短语按钮只在对局中显示（房间页/返回房间时隐藏）
  function setChatVisible(v) {
    var c = document.getElementById('liarChat');
    if (c) c.style.display = v ? '' : 'none';
  }

  // 联机 AI 补位（骗子酒馆）：轮到归我代打的 AI 槽位时，自动出牌/质疑
  var botPending = false;
  function maybeLiarBot() {
    if (botPending || app.introPlaying || !app.controls || !app.view) return;
    var v = app.view;
    if (v.phase !== 'playing') return;
    var acts = null;
    for (var s = 0; s < (v.players ? v.players.length : 4); s++) {
      if (!app.controls[s]) continue;
      if (v.current !== String(s)) continue;
      var hand = (v.ai && v.ai[s]) ? v.ai[s] : null;
      if (window.LiarAIBot) acts = window.LiarAIBot.decide(v, s, hand);
      break;
    }
    if (!acts) return;
    var arr = Array.isArray(acts) ? acts : [acts];
    botPending = true;
    arr.forEach(function (a) {
      setTimeout(function () {
        botPending = false;
        sendOnline(a);
      }, 700);
    });
  }

  function handleOnlineMessage(message) {
    if (message.type === 'ping') { sendOnline({ type: 'pong' }); return; }   // 服务端心跳应答
    if (message.type === 'error') {
      toast(message.msg || '操作失败');
      return;
    }
    if (message.type === 'welcome') {
      app.welcomed = true;
      app.connOk = true;
      app.youId = String(message.player);
      return;
    }
    if (message.type === 'lobby') {
      app.youId = String(message.you);
      app.connOk = true;
      app.controls = message.controls || null;   // 记录归我代打的 AI 槽位（用于联机 AI 补位）
      if (!message.started && app.lobby) {
        app.lobby.render(message);
        setChatVisible(false);                    // 房间页不显示快捷短语按钮
      } else if (app.lobby) {
        app.lobby.hide();
      }
      return;
    }
    if (message.type === 'phrase') {
      // 别人发的短语（只含代号）：在自己屏幕上从对方头像旁冒出
      showBubble(message.player, message.code);
      return;
    }
    if (message.type === 'state') {
      // 新局检测：round 前进且 phase=playing → 播开局动画（先手/底牌/发牌）
      var isNewRound = message.state.phase === 'playing' && (!app.view || message.state.round > (app.view.round || 0));
      if (isNewRound) lastNotified = 0;    // 联机新局：重置历史横幅指针，避免后续局不再弹通知
      var wasIntro = app.introPlaying;
      app.view = message.state;
      app.connOk = true;
      app.roomStarted = true;
      if (app.lobby) app.lobby.hide();
      app.selected.clear();
      app.busy = message.state.phase !== 'playing';
      showGame();
      setChatVisible(true);    // 进入对局才显示快捷短语按钮
      render();
      maybeLiarBot();   // 联机 AI 补位：若轮到归我代打的 AI，则自动出牌/质疑
      if (message.state.phase === 'ended') showEnd();
      else if (isNewRound && !wasIntro) {
        // 联机新局：播与单人一致的开局动画（联机双方各播各的，先手同源）
        app.introPlaying = true;
        playIntro().then(function () { app.introPlaying = false; });
      }
      return;
    }
    if (message.type === 'reveal') {
      app.busy = true;
      app.view = message.view || app.view;   // 服务端附带最新局面（含 shotsAfter）
      if (message.result) message.result.shotsAfter = message.result.shotsAfter != null ? message.result.shotsAfter : 0;
      showReveal(message.result, true).then(function () {
        // 联机：shooting 阶段交给开枪循环（服务端等 shoot 消息），否则自动下一局
        if (app.mode === 'solo') return;
        if (app.view && app.view.phase === 'shooting') return;
        sendOnline({ type: 'next' });
      });
      return;
    }
    if (message.type === 'shoot') {
      app.view = message.view || app.view;
      if (!message.result) { return; }
      // 播放开枪结果动画（含下一开枪者）
      playOnlineShoot(message.result);
      return;
    }
    if (message.type === 'next') {
      // 服务端已进入下一局，等待 state
      return;
    }
  }

  /* ---------- 教程 ---------- */
  var TUTORIAL = [
    { title: '看清本局指定牌', copy: '每局指定 A、K 或 Q；只有 JOKER 是万能牌，可充当任意指定牌。' },
    { title: '选牌暗扣', copy: '点击手牌选择 1–3 张，点「出牌」暗扣上桌，并宣称它们都是指定牌（可以说谎）。' },
    { title: '出牌或质疑', copy: '轮到你时，继续出牌增加桌面牌数，或点「质疑」揭穿上一位玩家（上家手牌出尽时只能质疑）。' },
    { title: '左轮裁决', copy: '质疑成功→撒谎者扣动左轮；质疑失败→你扣动左轮。弹巢随机，击发即淘汰，最后存活者获胜。' },
  ];
  var tutorialStep = 0;
  function renderTutorial() {
    var t = TUTORIAL[tutorialStep];
    els.tutorialTitle.textContent = t.title;
    els.tutorialCopy.textContent = t.copy;
    els.tutorialProgress.textContent = '第 ' + (tutorialStep + 1) + ' / ' + TUTORIAL.length + ' 步';
    els.tutorialVisual.dataset.step = tutorialStep;
    els.tutorialBackBtn.disabled = tutorialStep === 0;
    els.tutorialNextBtn.textContent = tutorialStep === TUTORIAL.length - 1 ? '开始游戏' : '下一步';
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    els.play.addEventListener('click', playSelected);
    els.challenge.addEventListener('click', challenge);
    els.continueBtn.addEventListener('click', continueLocal);
    bindShootButtons();
    els.restartBtn.addEventListener('click', function () {
      els.end.hidden = true;
      if (app.mode === 'solo') startSolo();
      else if (app.mode === 'online') { sendOnline({ type: 'reset' }); els.lobby.hidden = false; }
    });
    els.endLeaveBtn.addEventListener('click', function () { location.href = '../index.html'; });
    $('backToGameBtn').addEventListener('click', function () {
      if (app.mode === 'online' && app.lobby) {
        // 联机：返回房间等待室（离开对局）
        app.lobby.show(app.room ? app.room.code : '');
        setChatVisible(false);   // 回房间页隐藏快捷短语按钮
        els.game.hidden = true;
        els.reveal.hidden = true; els.end.hidden = true;
      } else {
        location.href = 'liar.html';
      }
    });
    $('closeRulesBtn').addEventListener('click', function () { els.rules.hidden = true; });
    $('resumeBtn').addEventListener('click', function () { els.rules.hidden = true; });
    $('exitGameBtn').addEventListener('click', function () {
      if (this.dataset.confirming) { location.href = '../index.html'; }
      this.dataset.confirming = '1';
      this.textContent = this.dataset.confirmLabel;
      var self = this;
      setTimeout(function () { if (self.dataset.confirming) { self.dataset.confirming = ''; self.textContent = self.dataset.defaultLabel; } }, 2500);
    });
    function openTutorial() { tutorialStep = 0; renderTutorial(); els.tutorial.hidden = false; }
    var tBtn = $('tutorialBtn');
    if (tBtn) tBtn.addEventListener('click', openTutorial);
    if ($('tutorialFromRules')) $('tutorialFromRules').addEventListener('click', function () { els.rules.hidden = true; openTutorial(); });
    var rBtn = $('rulesBtn');
    if (rBtn) rBtn.addEventListener('click', function () { els.rules.hidden = false; });
    $('closeTutorialBtn').addEventListener('click', function () { els.tutorial.hidden = true; });
    $('tutorialBackBtn').addEventListener('click', function () {
      if (tutorialStep > 0) { tutorialStep--; renderTutorial(); }
    });
    $('tutorialNextBtn').addEventListener('click', function () {
      if (tutorialStep < TUTORIAL.length - 1) { tutorialStep++; renderTutorial(); }
      else { els.tutorial.hidden = true; }
    });

    // 键盘快捷键
    document.addEventListener('keydown', function (e) {
      if (els.game.hidden) return;
      if (/^\d$/.test(e.key)) {
        var idx = Number(e.key) - 1;
        var card = els.hand.querySelector('[data-index="' + idx + '"]');
        if (card && !card.disabled) toggleCard(idx);
      } else if (e.key === 'p' || e.key === 'P') { if (!els.play.disabled) playSelected(); }
      else if (e.key === 'c' || e.key === 'C') { if (!els.challenge.disabled) challenge(); }
    });
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
    var ov = document.getElementById('landscapeOverlay');
    if (ov) ov.hidden = true;
  }


  /* ---------- 启动：URL 驱动开局 ---------- */
  function boot() {
    bind();
    bindChat();          // 快捷短语按钮与面板
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', function () { setTimeout(checkOrientation, 120); });

    var q = {};
    (location.search || '').replace(/[?&]([^=&]+)=([^&]*)/g, function (_, k, v) { q[k] = v; });
    var mode = q.mode || 'solo';
    els.reveal.hidden = true;
    els.game.hidden = false;
    if (mode === 'online') {
      var code = (q.room || '').toUpperCase();
      var role = q.role === 'host' ? true : false;
      connectRoom(code, role);
    } else {
      startSolo();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();