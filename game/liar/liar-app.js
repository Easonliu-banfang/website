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
        '<div class="liar-avatar-ring"><div class="liar-avatar">' + escapeHtml(player.avatar) + '</div><i class="liar-turn-dot"></i></div>' +
        '<div class="liar-name">' + escapeHtml(player.name) + '</div>' +
        '<div class="liar-status">' + status + '</div>' +
        '<div class="liar-mini-cards">' + cards + '</div>' +
        '<div class="liar-chambers">' + chambers + '</div>' +
        '</article>';
    }).join('');
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
    if (main) main.textContent = (winner.isMe ? '你' : winner.name) + ' 先出牌';
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
      window.Notify.show('🃏 ' + actor + ' 宣称打出 ' + view.lastPlay.count + ' 张 ' + view.target, 'info', { ttl: 3000 });
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
        window.Notify.show('👉 轮到你了！', 'info', { ttl: 2500 });
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
    app.engine = new GameEngine([{ id: 'you', name: '你', avatar: '♠' }].concat(AI_PLAYERS));
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
        if (window.Notify) window.Notify.show('🤔 ' + aiName + ' 正在考虑…', 'info', { ttl: 2200 });
        await sleepMs(1300);   // 考虑时间
        if (session !== app.session || app.paused || app.busy || !app.engine || app.engine.current !== currentId) return;
        if (app.engine.lastPlay && AI.shouldChallenge(app.engine, currentId)) {
          // 决定质疑：再盯一眼
          if (window.Notify) window.Notify.show('🕵 ' + aiName + ' 决定质疑！', 'warn', { ttl: 1800 });
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
    if (app.engine.phase === 'reveal') continueLocal();
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
    // 质疑结果顶部横幅（≥3 秒，红色高亮）
    if (window.Notify) {
      var revealText = result.lied
        ? '🕵 ' + playerName(result.challenger) + ' 识破了 ' + accusedName + ' 的谎言！'
        : '😨 ' + playerName(result.challenger) + ' 质疑失败，' + accusedName + ' 说的是真话';
      window.Notify.show(revealText, result.bang ? 'error' : 'warn', { ttl: 4000 });
    }
    // 左轮动画
    var chambers = els.roulette.querySelectorAll('.liar-chamber span');
    els.rouletteText.textContent = '左轮转动……';
    els.roulette.classList.add('spin');
    await sleep(700);
    chambers.forEach(function (c, i) { c.className = i < result.shotsAfter ? 'used' : ''; });
    els.rouletteText.textContent = result.bang ? '💥 击发了！' : '咔哒……空膛';
    if (result.bang) {
      await sleep(700);
      showEliminationImpact(loserName);
      await sleep(1800);          // 让「☠ OUT OF THE BAR」冲击动画完整播完（否则弹窗下一秒就关，动画等于没有）
      // 显示剩余人数（>1 人继续，==1 人决出冠军）
      var aliveNow = app.view.players.filter(function (p) { return p.alive !== false && p.id !== result.loser; }).length;
      if (aliveNow > 1) {
        els.revealCopy.textContent += ' 还剩 ' + aliveNow + ' 人继续。';
        if (window.Notify) window.Notify.show('💀 ' + loserName + ' 被淘汰，还剩 ' + aliveNow + ' 人', 'error', { ttl: 4000 });
      } else {
        els.revealCopy.textContent += ' 最后一人！';
        if (window.Notify) window.Notify.show('🏆 仅剩 1 人，冠军即将揭晓！', 'win', { ttl: 4000 });
      }
    }
    if (sequence !== app.revealSequence) return;
    if (online) {
      els.onlineContinue.hidden = false;
      await sleep(2600);
    } else {
      els.continueBtn.hidden = true;   // 取消「继续」按钮，直接 5 秒停留
      // 单人：质疑结果停留 5 秒让人看清，再自动进入下一局
      await sleep(5000);
      if (sequence !== app.revealSequence) return;
      els.reveal.hidden = true;
    }
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
    if (window.Notify) window.Notify.show('🏆 ' + wname + ' 成为最后的赢家！', 'win', { ttl: 4000 });
    els.endLeaveBtn.hidden = app.mode !== 'online';
    els.end.hidden = false;
  }

  /* ---------- 联机（复用 CF Worker 房间） ---------- */
  var WS_BASE = 'wss://quoridor-mp.pages.dev/api/room/';   // 注意：WS 端点需带 /ws 后缀（见 openSocket）
  var HTTP_BASE = 'https://quoridor-mp.pages.dev/api/room';

  function connectRoom(code, host) {
    // 昵称：优先 URL ?name= 参数（分享/大厅带入），否则随机「酒客·XX」避免全员同名难区分
    var qn = {};
    (location.search || '').replace(/[?&]([^=&]+)=([^&]*)/g, function (_, k, v) { qn[k] = v; });
    var name = (qn.name && String(qn.name).trim()) ? String(qn.name).slice(0, 10) : ('酒客·' + Math.floor(10 + Math.random() * 90));
    openSocket(code, name, host);
  }

  function openSocket(code, name, host) {
    app.mode = 'online';
    app.room = { code: code, host: host };
    var bk = document.getElementById('backToGameBtn');
    if (bk) bk.textContent = '← 返回房间';   // 联机模式：显示「返回房间」
    // 统一等待室（GameLobby 组件，对齐其余游戏）
    app.lobby = new window.GameLobby({
      onReady: function () { sendOnline({ type: 'ready' }); },
      onStart: function () { sendOnline({ type: 'start' }); },
      onNotify: function () { sendOnline({ type: 'notify' }); },
      onLeave: function () { if (app.ws) app.ws.close(); location.href = 'liar.html'; },
    });
    app.lobby.setCapacity(4);          // 骗子酒馆 2-4 人
    app.lobby.setMinToStart(2);       // 至少 2 人即可开局（不强制满 4）
    app.lobby.show(code);
    app.lobby.setStatus('已连接，等待准备开始', 'connected');
    var ws = new WebSocket(WS_BASE + encodeURIComponent(code) + '/ws');
    app.ws = ws;
    ws.onopen = function () {
      ws.send(JSON.stringify({ type: 'hello', name: name }));
      app.playerName = name;
    };
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      handleOnlineMessage(msg);
    };
    ws.onclose = function () {
      app.connOk = false;
      if (app.mode === 'online') toast('连接已断开');
    };
    ws.onerror = function () { toast('连接失败'); };
  }

  function sendOnline(message) {
    if (app.ws && app.ws.readyState === 1) app.ws.send(JSON.stringify(message));
  }

  function handleOnlineMessage(message) {
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
      if (!message.started && app.lobby) {
        app.lobby.render(message);
      } else if (app.lobby) {
        app.lobby.hide();
      }
      return;
    }
    if (message.type === 'state') {
      // 新局检测：round 前进且 phase=playing → 播开局动画（先手/底牌/发牌）
      var isNewRound = message.state.phase === 'playing' && (!app.view || message.state.round > (app.view.round || 0));
      var wasIntro = app.introPlaying;
      app.view = message.state;
      app.connOk = true;
      app.roomStarted = true;
      if (app.lobby) app.lobby.hide();
      app.selected.clear();
      app.busy = message.state.phase !== 'playing';
      showGame();
      render();
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
        // 联机：揭示动画后自动进入下一局
        if (app.mode === 'solo') return;
        sendOnline({ type: 'next' });
      });
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

  /* ---------- 横屏强制（与 UNO 一致） ---------- */
  function checkOrientation() {
    var landscape = window.innerWidth >= window.innerHeight;
    var ov = document.getElementById('landscapeOverlay');
    if (ov) ov.hidden = landscape;
  }

  /* ---------- 启动：URL 驱动开局 ---------- */
  function boot() {
    bind();
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