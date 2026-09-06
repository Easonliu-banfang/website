/* UNO（优诺UNO！）规则引擎 —— 官方规则，纯逻辑无 DOM。
 * 支持 双人/三人/四人 单打 与 2v2 组队（上排两席一队 / 下排两席一队）。
 *
 * 卡牌 id（小写）：
 *   数字   r0..r9 / b0.. / g0.. / y0..
 *   跳过   rs,bs,gs,ys    反转 rr,br,gr,yr   +2 rd,bd,gd,yd
 *   万色   w     万色+4 w4
 * 素材文件（uno/cards/）：色码大写 + 代号大写
 *   数字→数字、跳过→S、反转→R、+2→A2、万色→WC、万色+4→W4
 *   例：rs → RS.png（红跳过）；rr → RR.png（红反转）；rd → RA2.png（红+2）
 *
 * 状态机要点：
 *   nextDraw>0  → 该回合玩家必须摸（+2/+4 结算），摸完自动过
 *   awaitColor  → 刚出万色，出牌者需先 setColor 选色，选完才推进回合
 *   justDrew    → 主动摸 1 后：可立即出牌（play）或过（pass）
 *   UNO 喊叫    → 出到剩 1 张前未喊则自动罚摸 2；严格执行
 */
(function (global) {
  'use strict';

  var COLORS = ['r', 'b', 'g', 'y'];
  var COLOR_LABEL = { r: '红', b: '蓝', g: '绿', y: '黄' };

  function createDeck() {
    var d = [];
    COLORS.forEach(function (c) {
      d.push(c + '0');
      for (var n = 1; n <= 9; n++) d.push(c + n, c + n);
      d.push(c + 's', c + 's', c + 'r', c + 'r', c + 'd', c + 'd');
    });
    for (var i = 0; i < 4; i++) d.push('w', 'w4');
    return d;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function colorOf(id) { return id.charAt(0); }
  function kindOf(id) {
    if (id === 'w') return 'w';
    if (id === 'w4') return 'w4';
    var k = id.slice(1);
    if (k === 's') return 's';
    if (k === 'r') return 'r';
    if (k === 'd') return 'd';
    return 'n';
  }

  function fileFor(id) {
    var c = colorOf(id), k = kindOf(id);
    if (k === 'w') return 'WC.png';
    if (k === 'w4') return 'W4.png';
    var f = c.toUpperCase();
    if (k === 'n') return f + id.slice(1) + '.png';
    if (k === 's') return f + 'S.png';
    if (k === 'r') return f + 'R.png';
    return f + 'A2.png';
  }

  function createState(mode) {
    // 兼容字符串/数字两种传入（URL 参数为字符串 '3'/'4'/'2v2'）
    if (mode === '2v2') { /* 保持 */ }
    else {
      var m = parseInt(mode, 10);
      mode = (m === 3 || m === 4) ? m : 2;
    }
    var cap = (mode === '2v2') ? 4 : mode;
    var teams = null;
    if (mode === '2v2') teams = { 0: 0, 1: 0, 2: 1, 3: 1 };  // 下排0/1一队，上排2/3一队
    return {
      mode: mode, capacity: cap, teams: teams,
      deck: [], hands: [[], [], [], []],
      top: null, topColor: null,
      turn: 0, dir: 1,
      nextDraw: 0, awaitColor: false, justDrew: false,
      uno: [false, false, false, false],
      winner: -1, started: false
    };
  }

  function deal(state) {
    var deck = shuffle(createDeck());
    var cap = state.capacity;
    for (var i = 0; i < cap; i++) {
      state.hands[i] = [];
      for (var j = 0; j < 7; j++) state.hands[i].push(deck.pop());
    }
    var top = null;
    while (deck.length && (!top || kindOf(top) === 'w' || kindOf(top) === 'w4')) top = deck.pop();
    if (!top) top = 'w';
    state.deck = deck;
    state.top = top;
    state.topColor = colorOf(top);
    state.started = true;
    var k = kindOf(top), n = nextSlot(state, state.turn);
    if (k === 'd' || k === 'w4') { state.nextDraw = (k === 'd') ? 2 : 4; state.turn = n; }
    else if (k === 's') state.turn = n;
    else if (k === 'r') { if (cap === 2) state.turn = n; else state.dir = -1; }
    return state;
  }

  function validIdx(state, s) { return s >= 0 && s < state.capacity && !!state.hands[s]; }
  function nextSlot(state, s) { return (s + state.dir + state.capacity) % state.capacity; }

  function playable(state, s, cardId) {
    if (!validIdx(state, s) || s !== state.turn || state.nextDraw > 0 || state.awaitColor) return false;
    if ((state.hands[s] || []).indexOf(cardId) < 0) return false;
    var k = kindOf(cardId);
    if (k === 'w' || k === 'w4') return true;
    if (state.topColor && colorOf(cardId) === state.topColor) return true;
    // 符号匹配：数字必须相同，跳过/反转/+2 须同类
    var tk = kindOf(state.top);
    if (tk === k) {
      if (k === 'n') return cardId.slice(1) === state.top.slice(1);
      return true;
    }
    return false;
  }

  function playableCards(state, s) {
    if (!validIdx(state, s) || s !== state.turn) return [];
    return (state.hands[s] || []).filter(function (c) { return playable(state, s, c); });
  }

  function drawCards(state, s, n) {
    for (var i = 0; i < n; i++) {
      if (state.deck.length === 0) state.deck = shuffle(createDeck());
      state.hands[s].push(state.deck.pop());
    }
  }

  function play(state, s, id) {
    if (state.winner >= 0) return { ok: false, err: 'game over' };
    if (!validIdx(state, s) || s !== state.turn) return { ok: false, err: 'not your turn' };
    if (state.nextDraw > 0) return { ok: false, err: 'must draw first' };
    if (state.awaitColor) return { ok: false, err: 'choose color first' };
    var i = state.hands[s].indexOf(id);
    if (i < 0) return { ok: false, err: 'no such card' };
    if (!playable(state, s, id)) return { ok: false, err: 'illegal play' };

    // 严格：万色+4 只能在没有同色牌可出时使用
    if (kindOf(id) === 'w4') {
      // 官方：仅当手里没有任何「与当前颜色匹配」的牌时才可出万色+4（同数字不同色不算）
      var hasMatchColor = (state.hands[s] || []).some(function (c) {
        var kk = kindOf(c);
        if (kk === 'w' || kk === 'w4') return false;
        return state.topColor && colorOf(c) === state.topColor;
      });
      if (hasMatchColor) return { ok: false, err: 'wild+4 only when no matching color' };
    }

    state.hands[s].splice(i, 1);
    state.top = id;
    if (kindOf(id) !== 'w' && kindOf(id) !== 'w4') state.topColor = colorOf(id);
    state.justDrew = false;

    // UNO：出到剩 1 张 → 给出 4 秒宽容窗口喊「UNO」；超时未喊由 settleUno 罚摸 2
    if (state.hands[s].length === 1 && !state.uno[s]) {
      state.unoDueAt = (typeof Date !== 'undefined' ? Date.now() : 0) + 4000;
      state.unoSlot = s;
    }

    // 出完 → 胜利（2v2 按队伍）
    if (state.hands[s].length === 0) {
      state.winner = state.teams ? state.teams[s] : s;
      state.started = false;
      return { ok: true, winner: state.winner, err: null };
    }

    var k = kindOf(id);
    if (k === 'w' || k === 'w4') {
      state.awaitColor = true;                 // 等待出牌者选色（回合不推进）
    } else if (k === 's') {
      state.turn = nextSlot(state, nextSlot(state, s));
    } else if (k === 'r') {
      if (state.capacity === 2) state.turn = nextSlot(state, state.turn);
      else { state.dir = -state.dir; state.turn = nextSlot(state, s); }
    } else if (k === 'd') {
      state.nextDraw = 2;
      state.turn = nextSlot(state, s);
    } else {
      state.turn = nextSlot(state, s);
    }
    return { ok: true };
  }

  // 万色选色（出牌者），选完结算效果并推进
  function setColor(state, s, color) {
    if (state.winner >= 0) return { ok: false, err: 'game over' };
    if (!validIdx(state, s) || s !== state.turn || !state.awaitColor) return { ok: false, err: 'not your color pick' };
    if (COLORS.indexOf(color) < 0) return { ok: false, err: 'bad color' };
    state.topColor = color;
    state.awaitColor = false;
    var isW4 = kindOf(state.top) === 'w4';
    if (isW4) { state.nextDraw = 4; state.turn = nextSlot(state, s); }
    else state.turn = nextSlot(state, s);
    return { ok: true };
  }

  // 摸牌：被动(+2/+4) 或 主动摸 1
  function draw(state, s) {
    if (state.winner >= 0) return { ok: false, err: 'game over' };
    if (!validIdx(state, s) || s !== state.turn || state.awaitColor) return { ok: false, err: 'not your turn' };
    if (state.nextDraw > 0) {
      var n = state.nextDraw;
      state.nextDraw = 0;
      drawCards(state, s, n);
      state.turn = nextSlot(state, s);        // 被动结算完自动过
      state.justDrew = false;
      return { ok: true, drew: n, forced: true };
    }
    drawCards(state, s, 1);
    state.justDrew = true;                    // 主动摸 1：可立即出或过
    return { ok: true, drew: 1, forced: false };
  }

  // 过牌（主动摸牌后不出 或 直接过）
  function pass(state, s) {
    if (state.winner >= 0) return { ok: false, err: 'game over' };
    if (!validIdx(state, s) || s !== state.turn || state.awaitColor) return { ok: false, err: 'not your turn' };
    if (state.nextDraw > 0) return { ok: false, err: 'must draw first' };
    state.justDrew = false;
    state.turn = nextSlot(state, s);
    return { ok: true };
  }

  function callUno(state, s) {
    if (validIdx(state, s) && state.hands[s].length === 1) {
      state.uno[s] = true;
      state.unoDueAt = 0;      // 已喊，取消罚时
    }
    return { ok: true };
  }

  // 由调用方（worker）在消息循环/定时中调用：清算超时未喊 UNO 罚 2
  function settleUno(state, now) {
    if (state.unoDueAt && now > state.unoDueAt && state.unoSlot != null &&
        state.hands[state.unoSlot] && state.hands[state.unoSlot].length === 1 && !state.uno[state.unoSlot]) {
      drawCards(state, state.unoSlot, 2);
    }
    state.unoDueAt = 0;
    state.unoSlot = null;
  }

  global.Uno = {
    createState: createState, deal: deal,
    playable: playable, playableCards: playableCards,
    play: play, draw: draw, pass: pass, setColor: setColor, callUno: callUno, settleUno: settleUno,
    fileFor: fileFor, colorOf: colorOf, kindOf: kindOf,
    CREATE: createDeck, SHUFFLE: shuffle,
    COLOR_LABEL: COLOR_LABEL
  };
})(typeof window !== 'undefined' ? window : globalThis);