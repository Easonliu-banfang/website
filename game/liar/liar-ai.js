/* 骗子酒馆 AI（移植自 Hanazar-Games/Liars-Bar-webgame，MIT License）
 * 两个决策：
 *  - shouldChallenge：判断是否质疑上家（基于已知匹配牌数 + 桌面牌量 + 对方手牌数）
 *  - chooseAI：选择要出的牌（优先真目标牌，不够用假牌凑）
 */
(function (global) {
  'use strict';

  var E = global.LiarEngine;

  function shuffle(cards, random) {
    random = random || Math.random;
    for (var i = cards.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var t = cards[i]; cards[i] = cards[j]; cards[j] = t;
    }
    return cards;
  }

  // 是否质疑：返回 true 表示要质疑上家
  function shouldChallenge(engine, id) {
    var player = engine.player(id);
    var last = engine.lastPlay;
    if (!player.hand.length) return true;            // 没牌了只能质疑
    var knownMatches = player.hand.filter(function (card) {
      return E.cardMatchesTarget(card, engine.target);
    }).length;
    var impossible = knownMatches + last.count > 8;   // 桌面目标牌总数超过 8（6张真+2万能）必假
    var chance = 0.14 + last.count * 0.1 + (engine.pile.length > 9 ? 0.12 : 0) + (impossible ? 0.65 : 0);
    if (!engine.player(last.player).hand.length) chance += 0.3;
    return Math.random() < Math.min(0.92, chance);
  }

  // 选择出牌索引：优先真目标牌，数量不够拿假牌凑（1-3 张）
  function chooseAI(engine, id) {
    var player = engine.player(id);
    var matching = [];
    var other = [];
    player.hand.forEach(function (rank, index) {
      if (E.cardMatchesTarget(rank, engine.target)) matching.push(index);
      else other.push(index);
    });
    var count = Math.min(player.hand.length, 1 + (Math.random() < 0.28 ? 1 : 0) + (Math.random() < 0.08 ? 1 : 0));
    var chosen = shuffle(matching.slice()).slice(0, Math.min(count, matching.length));
    if (chosen.length < count) chosen = chosen.concat(shuffle(other.slice()).slice(0, count - chosen.length));
    return chosen;
  }

  global.LiarAI = { shouldChallenge: shouldChallenge, chooseAI: chooseAI };
})(typeof window !== 'undefined' ? window : globalThis);