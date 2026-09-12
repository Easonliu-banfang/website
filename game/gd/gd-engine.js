/* 掼蛋（Guandan）规则引擎 —— 移植自 mimaima699-ux/Guandan-Poker-Platform（MIT）
 * 纯逻辑无 DOM：牌型识别（含逢人配）、压牌、进贡/还贡/抗贡、接风、升级(3/2/1)、过A。
 * 供 Worker（服务端权威）与前端（牌型提示/渲染）共用。
 *
 * 牌编码（数字）：copy(bit7) | code(bit2-6) | suit(bit0-1)
 *   code: 2..14(11=J..14=A) 15=小王 16=大王；suit: 0=♦ 1=♣ 2=♠ 3=♥
 */
(function (global) {
  'use strict';

  var HEART = 3, SMALL = 15, BIG = 16;

  function makeCard(code, suit, copy) { return (copy << 7) | (code << 2) | suit; }
  function codeOf(c) { return (c >> 2) & 0x1f; }
  function suitOf(c) { return c & 3; }
  function copyOf(c) { return (c >> 7) & 1; }
  function isJoker(c) { return codeOf(c) >= SMALL; }

  // 牌面大小序（级牌介于 A 与小王之间；非级牌的 2 最小）
  function orderKey(code, level) {
    if (code === level) return 13;
    if (code >= SMALL) return code - 1;      // 小王14 大王15
    if (code === 2) return -1;
    return code - 3;                          // 3→0 … A→11
  }
  // 红桃级牌 = 逢人配（百搭）
  function isWild(c, level) { return suitOf(c) === HEART && codeOf(c) === level; }

  function buildDeck() {
    var out = [];
    for (var copy = 0; copy < 2; copy++) {
      for (var suit = 0; suit < 4; suit++)
        for (var code = 2; code <= 14; code++) out.push(makeCard(code, suit, copy));
      out.push(makeCard(SMALL, 0, copy), makeCard(BIG, 0, copy));
    }
    return out;  // 108
  }

  function sortHand(cards, level) {
    return cards.slice().sort(function (a, b) {
      var ka = orderKey(codeOf(a), level), kb = orderKey(codeOf(b), level);
      if (kb !== ka) return kb - ka;
      return a - b;
    });
  }

  /* ---------- 牌型 ---------- */
  function sizeOfShape(s) {
    switch (s.k) {
      case 'single': return 1;
      case 'pair': return 2;
      case 'trio': return 3;
      case 'trioPlusPair': return 5;
      case 'trioRun': return 6;
      case 'steel': return s.kickers === 0 ? 3 * s.len : 5 * s.len;
      case 'straight': case 'flushStraight': return 5;
      case 'bomb': return s.size;
      case 'jokerBomb': return 4;
    }
    return 0;
  }
  function tierOf(s) {
    switch (s.k) {
      case 'jokerBomb': return 4;
      case 'bomb': return s.size >= 6 ? 3 : 1;
      case 'flushStraight': return 2;
      default: return 0;
    }
  }
  function keyOf(s) { return s.key || 0; }
  // a 是否压过 b
  function beats(a, b) {
    var ta = tierOf(a), tb = tierOf(b);
    if (ta !== tb) return ta > tb;
    if (ta === 4) return false;
    if (ta === 2) return keyOf(a) > keyOf(b);
    if (ta === 1 || ta === 3) return a.size > b.size || (a.size === b.size && a.key > b.key);
    if (a.k !== b.k) return false;
    if (sizeOfShape(a) !== sizeOfShape(b)) return false;
    return keyOf(a) > keyOf(b);
  }

  /* ---------- 连序窗口 ---------- */
  function straightWindows(level) {
    var out = [];
    if (level !== 2 && level !== 14) out.push({ ranks: [14, 2, 3, 4, 5], topCode: 5 });
    for (var s = 3; s <= 10; s++) {
      var ranks = [s, s + 1, s + 2, s + 3, s + 4];
      if (ranks.indexOf(level) >= 0) continue;
      out.push({ ranks: ranks, topCode: s + 4 });
    }
    return out;
  }
  function runWindows(level, len) {
    var out = [];
    for (var s = 3; s + len - 1 <= 14; s++) {
      var ranks = [];
      for (var i = 0; i < len; i++) ranks.push(s + i);
      if (ranks.indexOf(level) >= 0) continue;
      out.push({ ranks: ranks, topCode: s + len - 1 });
    }
    return out;
  }

  /* ---------- 手牌视图 ---------- */
  function handInfo(cards, level) {
    var byCode = {};   // code -> [cards]
    var wilds = [];
    var hist = new Array(17).fill(0);
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (isWild(c, level)) { wilds.push(c); continue; }
      var code = codeOf(c);
      (byCode[code] = byCode[code] || []).push(c);
      hist[code]++;
    }
    return { cards: cards.slice(), level: level, byCode: byCode, wilds: wilds, hist: hist };
  }

  /* ---------- 牌型识别（含逢人配补位） ---------- */
  function distinctNaturalCodes(info) { return Object.keys(info.byCode).map(Number); }
  function windowExactFit(info, ranks, need, w) {
    var fill = 0;
    for (var i = 0; i < ranks.length; i++) {
      var r = ranks[i];
      var h = info.hist[r] || 0;
      if (h > need) return false;
      fill += need - h;
    }
    if (fill !== w) return false;
    for (var c in info.byCode) if (info.byCode[c].length > 0 && ranks.indexOf(Number(c)) < 0) return false;
    return true;
  }

  function interpret(cards, level) {
    var info = handInfo(cards, level);
    var n = cards.length, w = info.wilds.length;
    var H = function (code) { return info.hist[code] || 0; };
    var out = [], seen = {};
    function add(shape) {
      var sig = shape.k + '|' + (shape.key || 0) + '|' + (shape.size || 0) + '|' + (shape.len || 0) + '|' + (shape.kickers || 0) + '|' + (shape.suit || '');
      if (seen[sig]) return;
      seen[sig] = true;
      out.push(shape);
    }
    var natCodes = distinctNaturalCodes(info);

    if (n === 1) {
      if (w === 1) add({ k: 'single', key: 13 });
      else add({ k: 'single', key: orderKey(codeOf(cards[0]), level) });
    }
    if (n === 2) {
      if (w === 0) {
        var a = codeOf(cards[0]), b = codeOf(cards[1]);
        if (a === b && !isJoker(cards[0])) add({ k: 'pair', key: orderKey(a, level) });
      } else if (w === 1) {
        var nat = null;
        for (var i = 0; i < cards.length; i++) if (info.wilds.indexOf(cards[i]) < 0) { nat = cards[i]; break; }
        if (nat !== null && !isJoker(nat)) add({ k: 'pair', key: orderKey(codeOf(nat), level) });
      } else {
        add({ k: 'pair', key: 13 });
      }
    }
    if (n === 3) {
      if (natCodes.length === 1 && !isJokerCodeOf(natCodes[0])) add({ k: 'trio', key: orderKey(natCodes[0], level) });
    }
    if (n >= 4 && n <= 8) {
      if (natCodes.length === 1 && !isJokerCodeOf(natCodes[0])) add({ k: 'bomb', key: orderKey(natCodes[0], level), size: n });
      if (n === 4 && w === 0 && H(15) === 2 && H(16) === 2) add({ k: 'jokerBomb' });
    }
    if (n === 5) {
      // 三带二
      for (var t in info.byCode) {
        t = Number(t);
        if (isJokerCodeOf(t)) continue;
        var ht = info.byCode[t].length;
        if (ht < 1 || ht > 3) continue;
        var wTrio = 3 - ht;
        if (wTrio > w) continue;
        var wr = w - wTrio;
        var pairOk = false;
        for (var p in info.byCode) {
          p = Number(p);
          if (p === t) continue;
          var cnt = info.byCode[p].length;
          if (cnt < 1 || cnt > 2) continue;
          if (isJokerCodeOf(p)) continue;
          if (cnt === 2 || wr >= 1) { pairOk = true; break; }
        }
        if (!pairOk && wr >= 2) pairOk = true;
        if (pairOk) add({ k: 'trioPlusPair', key: orderKey(t, level) });
      }
      // 顺子 / 同花顺
      var natSuits = {};
      for (var j = 0; j < cards.length; j++) {
        if (info.wilds.indexOf(cards[j]) >= 0) continue;
        if (isJoker(cards[j])) natSuits[-1] = true; else natSuits[suitOf(cards[j])] = true;
      }
      var sw = straightWindows(level);
      for (var si = 0; si < sw.length; si++) {
        var win = sw[si];
        if (!windowExactFit(info, win.ranks, 1, w)) continue;
        add({ k: 'straight', key: orderKey(win.topCode, level) });
        if (Object.keys(natSuits).length === 1 && !natSuits[-1]) {
          add({ k: 'flushStraight', key: orderKey(win.topCode, level), suit: Number(Object.keys(natSuits)[0]) });
        }
      }
    }
    if (n === 6) {
      // 三连对
      var rw = runWindows(level, 3);
      for (var ri = 0; ri < rw.length; ri++) {
        if (windowExactFit(info, rw[ri].ranks, 2, w)) add({ k: 'trioRun', key: orderKey(rw[ri].topCode, level) });
      }
      // 裸钢板（2 连三张）
      var cfg2 = { len: 2, kickers: 0 };
      for (var si2 = 0; si2 < runWindows(level, 2).length; si2++) {
        var w2 = runWindows(level, 2)[si2];
        var fill2 = 0, ok2 = true;
        for (var q = 0; q < w2.ranks.length; q++) { fill2 += Math.max(0, 3 - H(w2.ranks[q])); }
        if (fill2 > w) continue;
        for (var c3 in info.byCode) { if (info.byCode[c3].length > 0 && w2.ranks.indexOf(Number(c3)) < 0) { ok2 = false; break; } }
        if (ok2 && fill2 === w) add({ k: 'steel', key: orderKey(w2.topCode, level), len: 2, kickers: 0 });
      }
    }
    // 排序：火力降序、点数降序
    out.sort(function (a, b) {
      var ta = tierOf(a), tb = tierOf(b);
      if (ta !== tb) return tb - ta;
      return (keyOf(b) || 0) - (keyOf(a) || 0);
    });
    return out;
  }
  function isJokerCodeOf(code) { return code >= SMALL; }

  /* ---------- 引擎状态机 ---------- */
  function createMatch() {
    return { handNo: 0, levels: [2, 2], prevPlacements: null, winner: null };
  }
  function handLevel(levels) { return Math.max(levels[0], levels[1]); }

  function dealHands(rng) {
    var deck = buildDeck();
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    // 四人各 27 张
    var hands = [[], [], [], []];
    for (var k = 0; k < 108; k++) hands[k % 4].push(deck[k]);
    return hands;
  }

  function partnerOf(seat) { return (seat + 2) % 4; }
  function teamOf(seat) { return seat % 2; }
  function nextSeat(seat) { return (seat + 1) % 4; }
  function activeSeats(h) {
    var out = [];
    for (var s = 0; s < 4; s++) if (h.hands[s].length > 0) out.push(s);
    return out;
  }
  function nextActive(h, from) {
    var s = from;
    for (var i = 0; i < 4; i++) { if (h.hands[s].length > 0) return s; s = nextSeat(s); }
    return null;
  }

  // 创建/续局状态
  function beginHand(match, rng) {
    var events = [];
    var level = handLevel(match.levels);
    var hands = dealHands(rng);
    var prev = match.prevPlacements;
    var tribute = null, phase = 'playing', leader;
    if (!prev) {
      leader = Math.floor(rng() * 4);
    } else {
      var first = prev[0];
      var doubleDown = teamOf(prev[1]) === teamOf(first);
      var moYou = prev[3], sanYou = prev[2];
      var tributers = doubleDown ? [moYou, sanYou] : [moYou];
      var bigJokers = 0;
      tributers.forEach(function (s) { hands[s].forEach(function (c) { if (codeOf(c) === BIG) bigJokers++; }); });
      if (bigJokers >= 2) {
        tribute = { kind: doubleDown ? 'double' : 'single', pairs: [], resisted: true };
        leader = first;
        events.push({ t: 'tributeResisted' });
      } else if (doubleDown) {
        tribute = { kind: 'double', pairs: [
          { from: moYou, to: first, card: null, returned: null },
          { from: sanYou, to: prev[1], card: null, returned: null } ] };
        phase = 'tribute'; leader = -1;
      } else {
        tribute = { kind: 'single', pairs: [{ from: moYou, to: first, card: null, returned: null }] };
        phase = 'tribute'; leader = -1;
      }
    }
    var hand = {
      level: level, hands: hands, leader: leader, turn: leader,
      last: null, passes: 0, placements: [], currentTrick: [], stream: [], tribute: tribute
    };
    events.unshift({ t: 'dealt', level: level, leader: leader });
    return { match: { handNo: match.handNo + 1, levels: match.levels.slice(), prevPlacements: match.prevPlacements, winner: match.winner },
             phase: phase, hand: hand, events: events };
  }

  function tributableCards(state, seat) {
    var h = state.hand;
    if (!h || state.phase !== 'tribute' || !h.tribute) return [];
    var pair = null;
    h.tribute.pairs.forEach(function (p) { if (p.from === seat && p.card === null) pair = p; });
    if (!pair) return [];
    var cands = h.hands[seat].filter(function (c) { return !isWild(c, h.level); });
    if (!cands.length) return [];
    var maxKey = -99;
    cands.forEach(function (c) { maxKey = Math.max(maxKey, orderKey(codeOf(c), h.level)); });
    return cands.filter(function (c) { return orderKey(codeOf(c), h.level) === maxKey; });
  }
  function returnableCards(state, seat) {
    var h = state.hand;
    if (!h || state.phase !== 'tributeReturn' || !h.tribute) return [];
    var pair = null;
    h.tribute.pairs.forEach(function (p) { if (p.to === seat && p.returned === null) pair = p; });
    if (!pair) return [];
    return h.hands[seat].filter(function (c) { return !isWild(c, h.level) && codeOf(c) <= 10; });
  }

  function applyTribute(state, seat, card) {
    var h = state.hand;
    if (!h || state.phase !== 'tribute') return { ok: false, error: '当前不在进贡阶段' };
    var trib = h.tribute;
    var pair = null;
    trib.pairs.forEach(function (p) { if (p.from === seat && p.card === null) pair = p; });
    if (!pair) return { ok: false, error: '该座位无需进贡' };
    var hand = h.hands[seat];
    if (hand.indexOf(card) < 0) return { ok: false, error: '贡牌不在手中' };
    if (isWild(card, h.level)) return { ok: false, error: '逢人配不可进贡' };
    var maxKey = -99;
    hand.forEach(function (c) { if (!isWild(c, h.level)) maxKey = Math.max(maxKey, orderKey(codeOf(c), h.level)); });
    if (orderKey(codeOf(card), h.level) !== maxKey) return { ok: false, error: '进贡必须交出手中最大的牌（逢人配除外）' };
    var hands = h.hands.map(function (x) { return x.slice(); });
    hands[seat] = hands[seat].filter(function (c) { return c !== card; });
    hands[pair.to] = sortHand(hands[pair.to].concat([card]), h.level);
    var pairs = trib.pairs.map(function (p) { return p === pair ? { from: p.from, to: p.to, card: card, returned: null } : p; });
    var allDone = pairs.every(function (p) { return p.card !== null; });
    return { ok: true, state: { phase: allDone ? 'tributeReturn' : 'tribute', hand: { ...h, hands: hands, tribute: { ...trib, pairs: pairs } } } };
  }

  function applyReturn(state, seat, card) {
    var h = state.hand;
    if (!h || state.phase !== 'tributeReturn') return { ok: false, error: '当前不在还贡阶段' };
    var trib = h.tribute;
    var pair = null;
    trib.pairs.forEach(function (p) { if (p.to === seat && p.returned === null) pair = p; });
    if (!pair) return { ok: false, error: '该座位无需还贡' };
    var hand = h.hands[seat];
    if (hand.indexOf(card) < 0) return { ok: false, error: '还贡牌不在手中' };
    if (isWild(card, h.level)) return { ok: false, error: '逢人配不可还贡' };
    if (codeOf(card) > 10) return { ok: false, error: '还贡不得大于 10' };
    var hands = h.hands.map(function (x) { return x.slice(); });
    hands[seat] = hands[seat].filter(function (c) { return c !== card; });
    hands[pair.from] = sortHand(hands[pair.from].concat([card]), h.level);
    var pairs = trib.pairs.map(function (p) { return p === pair ? { from: p.from, to: p.to, card: p.card, returned: card } : p; });
    var allDone = pairs.every(function (p) { return p.returned !== null; });
    var leader = h.leader, turn = h.turn;
    if (allDone) {
      var prev = state.match.prevPlacements;
      var best = null, tie = false;
      pairs.forEach(function (p) {
        var k = orderKey(codeOf(p.card), h.level);
        if (!best || k > orderKey(codeOf(best.card), h.level)) { best = p; tie = false; }
        else if (k === orderKey(codeOf(best.card), h.level) && best && p.from !== best.from) tie = true;
      });
      leader = tie ? prev[0] : best.to;
      turn = leader;
    }
    return { ok: true, state: { phase: allDone ? 'playing' : 'tributeReturn', hand: { ...h, hands: hands, tribute: { ...trib, pairs: pairs }, leader: leader, turn: turn } } };
  }

  function applyPlay(state, seat, cards, interpId) {
    var h = state.hand;
    if (!h || state.phase !== 'playing') return { ok: false, error: '当前不在出牌阶段' };
    if (h.turn !== seat) return { ok: false, error: '还没轮到该座位' };
    if (!cards || !cards.length) return { ok: false, error: '出牌不能为空' };
    var hand = h.hands[seat];
    for (var i = 0; i < cards.length; i++) if (hand.indexOf(cards[i]) < 0) return { ok: false, error: '所出牌不在手中' };
    var interps = interpret(cards, h.level);
    if (!interps.length) return { ok: false, error: '无法识别的牌型' };
    if (interpId < 0 || interpId >= interps.length) return { ok: false, error: '解释编号无效' };
    var shape = interps[interpId];
    if (h.last && !beats(shape, h.last.shape)) return { ok: false, error: '该牌型压不过上家' };

    var hands = h.hands.map(function (x) { return x.slice(); });
    hands[seat] = hands[seat].filter(function (c) { return cards.indexOf(c) < 0; });
    var placements = h.placements.slice();
    var out = hands[seat].length === 0;
    if (out) placements.push(seat);
    var last = { seat: seat, cards: cards.slice(), shape: shape };
    var currentTrick = h.currentTrick.concat([{ seat: seat, cards: cards.slice(), shape: shape, pass: false }]);
    var stream = h.stream.concat([{ seat: seat, cards: cards.slice(), shape: shape }]);

    if (placements.length === 3) {
      var remaining = -1;
      for (var s = 0; s < 4; s++) if (placements.indexOf(s) < 0) { remaining = s; break; }
      placements.push(remaining);
      var h2 = { ...h, hands: hands, placements: placements, last: last, currentTrick: currentTrick, stream: stream, passes: 0 };
      return finishHand(state, h2);
    }
    var nxt = nextActive({ ...h, hands: hands }, nextSeat(seat));
    return { ok: true, state: { phase: 'playing', hand: { ...h, hands: hands, placements: placements, last: last, currentTrick: currentTrick, stream: stream, passes: 0, turn: nxt } } };
  }

  function applyPass(state, seat) {
    var h = state.hand;
    if (!h || state.phase !== 'playing') return { ok: false, error: '当前不在出牌阶段' };
    if (h.turn !== seat) return { ok: false, error: '还没轮到该座位' };
    if (!h.last) return { ok: false, error: '首出必须出牌' };
    if (h.hands[seat].length === 0) return { ok: false, error: '已出完牌' };
    var currentTrick = h.currentTrick.concat([{ seat: seat, cards: [], shape: null, pass: true }]);
    var passes = h.passes + 1;
    var actives = activeSeats(h);
    var lastOut = h.hands[h.last.seat].length === 0;
    var needed = lastOut ? actives.length : actives.length - 1;
    if (passes >= needed) {
      var winner = h.last.seat;
      var target = winner;
      if (h.hands[winner].length === 0) {
        var nxt2 = nextActive(h, partnerOf(winner));
        if (nxt2 === null) return { ok: false, error: '接风无目标' };
        target = nxt2;
      }
      return { ok: true, state: { phase: 'playing', hand: { ...h, passes: 0, last: null, currentTrick: [], leader: target, turn: target } } };
    }
    var nxt = nextActive(h, nextSeat(seat));
    return { ok: true, state: { phase: 'playing', hand: { ...h, passes: passes, currentTrick: currentTrick, turn: nxt } } };
  }

  function finishHand(state, hand) {
    var placements = hand.placements;
    var winnerTeam = teamOf(placements[0]);
    var partnerPlace = placements.indexOf(partnerOf(placements[0])) + 1;
    var ups = { doubleDown: 3, oneThree: 2, oneFour: 1 };
    var levelUp = partnerPlace === 2 ? ups.doubleDown : partnerPlace === 3 ? ups.oneThree : ups.oneFour;
    var newLevel = Math.min(14, hand.level + levelUp);
    var levels = state.match.levels.slice();
    levels[winnerTeam] = newLevel;
    var playingAtA = hand.level === 14;
    var passA = playingAtA && (partnerPlace === 2);
    var phase = passA ? 'matchOver' : 'handOver';
    return { ok: true, state: { phase: phase, match: { ...state.match, levels: levels, prevPlacements: placements.slice(), winner: passA ? winnerTeam : null }, hand: { ...hand, turn: placements[3] } } };
  }

  function actorSeat(state) {
    if (!state.hand) return 0;
    var h = state.hand;
    if (state.phase === 'tribute') {
      for (var i = 0; i < h.tribute.pairs.length; i++) if (h.tribute.pairs[i].card === null) return h.tribute.pairs[i].from;
      return 0;
    }
    if (state.phase === 'tributeReturn') {
      for (var j = 0; j < h.tribute.pairs.length; j++) if (h.tribute.pairs[j].returned === null) return h.tribute.pairs[j].to;
      return 0;
    }
    return h.turn;
  }

  // 对战是否结束（供房间复用）
  function matchOver(state) { return state.phase === 'matchOver'; }

  /* ---------- 对外 API ---------- */
  global.GD = {
    makeCard: makeCard, codeOf: codeOf, suitOf: suitOf, copyOf: copyOf,
    isJoker: isJoker, isWild: isWild, orderKey: orderKey,
    sortHand: sortHand, buildDeck: buildDeck,
    interpret: interpret, beats: beats, sizeOfShape: sizeOfShape, tierOf: tierOf,
    createMatch: createMatch, handLevel: handLevel, beginHand: beginHand,
    dealHands: dealHands,
    tributableCards: tributableCards, returnableCards: returnableCards,
    applyTribute: applyTribute, applyReturn: applyReturn,
    applyPlay: applyPlay, applyPass: applyPass, actorSeat: actorSeat,
    matchOver: matchOver, teamOf: teamOf, partnerOf: partnerOf,
    SMALL: SMALL, BIG: BIG, HEART: HEART
  };
})(typeof window !== 'undefined' ? window : globalThis);
