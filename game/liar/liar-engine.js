/* 骗子酒馆引擎（移植自 Hanazar-Games/Liars-Bar-webgame，MIT License）
 * 纯规则：发牌/出牌/质疑/左轮淘汰。浏览器与 Cloudflare Worker 双环境可用。
 */
(function (global) {
  'use strict';
const RANKS = ['A', 'K', 'Q'];
const WILD_CARD = 'JOKER';
const CARD_NAMES = { A: 'A牌', K: '国王', Q: '皇后', JOKER: '万能牌 · JOKER' };

const cardMatchesTarget = (card, target) => card === target || card === WILD_CARD;

function shuffle(cards, random = Math.random) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function createDeck(random = Math.random) {
  return shuffle([
    ...Array(6).fill('A'),
    ...Array(6).fill('K'),
    ...Array(6).fill('Q'),
    WILD_CARD,
    WILD_CARD,
  ], random);
}

class GameEngine {
  constructor(players, { random = Math.random } = {}) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
      throw new Error('玩家人数必须为 2–4 人');
    }
    if (new Set(players.map(({ id }) => id)).size !== players.length) {
      throw new Error('玩家 ID 不能重复');
    }

    this.random = random;
    this.players = players.map(({ id, name, avatar = '♠', bot = false }) => ({
      id,
      name,
      avatar,
      bot,
      alive: true,
      connected: true,
      hand: [],
      shots: 0,
      liveLeft: 1,        // 剩余实弹数
      blankLeft: 5,       // 剩余虚弹数
      cylinder: null,     // 内部：随机装填顺序（保密，视图不透传）
    }));
    this.round = 0;
    this.target = 'K';
    this.current = null;
    this.lastPlay = null;
    this.pile = [];
    this.phase = 'lobby';
    this.history = [];
    this.winner = null;
    this.reveal = null;
  }

  start() {
    this.players.forEach((player) => {
      player.alive = true;
      player.connected = true;
      player.hand = [];
      player.shots = 0;
      this.loadCylinder(player);        // 装填：1 发实弹 + 5 发虚弹，顺序随机保密
    });
    this.round = 0;
    this.history = [];
    this.winner = null;
    return this.startRound();
  }

  // 装填左轮：1 发实弹 + 5 发虚弹，顺序由 random 打乱（前端与 AI 均无法预知下一发）
  loadCylinder(player) {
    const chambers = [true, false, false, false, false, false];   // true=实弹
    for (let i = chambers.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [chambers[i], chambers[j]] = [chambers[j], chambers[i]];
    }
    player.cylinder = chambers;
    player.liveLeft = chambers.filter(Boolean).length;
    player.blankLeft = chambers.length - player.liveLeft;
    player.shots = 0;
  }

  // 扣一次扳机：从剩余弹巢随机抽一发（不可预知）
  pullTrigger(player) {
    if (!player.cylinder || !player.cylinder.length) {
      // 兜底：弹巢耗尽按剩余数量比例
      const isLive = player.liveLeft > 0;
      if (isLive) player.liveLeft -= 1; else player.blankLeft = Math.max(0, player.blankLeft - 1);
      player.shots += 1;
      return isLive;
    }
    const idx = Math.floor(this.random() * player.cylinder.length);
    const isLive = !!player.cylinder.splice(idx, 1)[0];
    if (isLive) player.liveLeft = Math.max(0, player.liveLeft - 1);
    else player.blankLeft = Math.max(0, player.blankLeft - 1);
    player.shots += 1;
    if (isLive) player.cylinder.length = 0;   // 中弹即中止（弹巢清空）
    return isLive;
  }

  startRound() {
    if (this.alivePlayers().length <= 1) return this.finish();

    this.round += 1;
    this.target = RANKS[Math.floor(this.random() * RANKS.length)];
    this.pile = [];
    this.lastPlay = null;
    this.reveal = null;
    this.phase = 'playing';

    const deck = createDeck(this.random);
    this.players.forEach((player) => {
      player.hand = player.alive ? deck.splice(0, 5) : [];
    });
    // 每局重新装填存活玩家的左轮（1 实 5 虚，随机顺序）
    this.players.forEach((player) => { if (player.alive) this.loadCylinder(player); });
    const candidates = this.alivePlayers();
    this.current = candidates[Math.floor(this.random() * candidates.length)].id;
    this.log(`第 ${this.round} 局开始，指定牌是 ${this.target}`);
    return this.viewFor(this.current);
  }

  alivePlayers() {
    return this.players.filter((player) => player.alive);
  }

  player(id) {
    const player = this.players.find((candidate) => candidate.id === id);
    if (!player) throw new Error('玩家不存在');
    return player;
  }

  nextAlive(id) {
    let index = this.players.findIndex((player) => player.id === id);
    for (let checked = 0; checked < this.players.length; checked += 1) {
      index = (index + 1) % this.players.length;
      if (this.players[index].alive) return this.players[index].id;
    }
    return null;
  }

  assertTurn(id) {
    if (this.phase !== 'playing') throw new Error('当前不能行动');
    if (this.current !== id) throw new Error('还没轮到你');
    if (!this.player(id).alive) throw new Error('你已被淘汰');
  }

  play(id, indices) {
    this.assertTurn(id);
    if (!Array.isArray(indices) || indices.length < 1 || indices.length > 3) {
      throw new Error('请选择 1–3 张牌');
    }
    if (new Set(indices).size !== indices.length) throw new Error('不能选择重复的牌');

    const player = this.player(id);
    if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) {
      throw new Error('包含无效手牌');
    }

    const cards = [...indices]
      .sort((a, b) => b - a)
      .map((index) => player.hand.splice(index, 1)[0])
      .reverse();
    this.pile.push(...cards);
    this.lastPlay = { player: id, cards, count: cards.length };
    this.log(`${player.name} 宣称打出 ${cards.length} 张 ${this.target}`);
    if (!player.hand.length) this.log(`${player.name} 已经出完手牌`);
    this.current = this.nextAlive(id);
    return { player: id, cards, count: cards.length };
  }

  challenge(id) {
    this.assertTurn(id);
    if (!this.lastPlay) throw new Error('现在没有可以质疑的出牌');

    const play = this.lastPlay;
    const lied = play.cards.some((card) => !cardMatchesTarget(card, this.target));
    const loser = lied ? play.player : id;
    this.phase = 'shooting';          // 质疑分出胜负 → 开枪阶段：输家选择朝谁开枪
    this.log(`${this.player(id).name} 质疑 ${this.player(play.player).name}`);
    this.reveal = {
      challenger: id,
      accused: play.player,
      cards: [...play.cards],
      lied,
      loser,
      shooter: loser,                 // 第一个开枪者 = 输家
      pending: true,                  // 等待 shooter 选择方向
    };
    return { ...this.reveal, cards: [...this.reveal.cards] };
  }

  // 开枪：shooter 选择方向（朝自己 / 朝对方[质疑者]）
  // 规则：
  //   朝对方开枪 → 对方承受；对方没死 → 轮到对方开枪；对方死 → 轮到死亡者下一位存活者
  //   朝自己开枪 → 空弹(没死) → 自己可再开一枪；实弹(死) → 轮到死亡者下一位存活者
  //   中弹者出局；只剩 1 人 → 整局结束
  shoot(id, target) {
    if (this.phase !== 'shooting') throw new Error('当前不在开枪阶段');
    const reveal = this.reveal;
    if (reveal.shooter !== id) throw new Error('还轮不到你开枪');
    if (target !== 'self' && target !== 'other') throw new Error('无效的开枪方向');
    if (!this.player(id).alive) throw new Error('你已被淘汰');

    // 受枪者：朝自己 → 开枪者；朝对方 → 质疑者（必须存活，否则换下一个存活对手）
    let victimId = id;
    if (target === 'other') {
      victimId = reveal.challenger;
      if (victimId === id || !this.player(victimId).alive) victimId = this.nextAlive(id);
    }
    if (!victimId || !this.player(victimId).alive) {
      // 找不到可开枪的对象（理论上已 finish）→ 直接结束惩罚
      throw new Error('没有可开枪的对象');
    }
    const victim = this.player(victimId);
    const bang = this.pullTrigger(victim);      // 随机抽一发，谁也预知不了
    if (bang) victim.alive = false;
    this.log(`${this.player(id).name} ${target === 'self' ? '朝自己' : '朝 ' + this.player(victimId).name + ' 开枪'}`);

    // 决定下一开枪者（轮流开枪直到有人中弹出局）
    let nextShooter = null;
    if (target === 'self') {
      if (!bang) nextShooter = id;              // 空弹：自己可再开一枪
      else nextShooter = this.nextAlive(id);    // 中弹：轮到下一位存活者
    } else {
      if (!bang) nextShooter = victimId;        // 对方没死：轮到对方开枪
      else nextShooter = this.nextAlive(victimId);  // 对方死：轮到下一位存活者
    }

    // 下一开枪者必须存活（否则顺延到下一位存活者；若都不行则结束惩罚）
    if (nextShooter != null && (!this.player(nextShooter) || !this.player(nextShooter).alive)) {
      nextShooter = this.nextAlive(nextShooter);
    }
    this.reveal = {
      ...reveal,
      shooter: nextShooter,
      pending: nextShooter != null,
      victim: victimId,
      bang,
      shotsAfter: victim.shots,
    };

    // 只剩 1 人 → 整局结束；否则若无人可开枪 → 结束惩罚（可下一局）
    if (this.alivePlayers().length <= 1) {
      this.finish();
    } else if (!this.reveal.shooter) {
      this.phase = 'reveal';   // 无下一开枪者 → 惩罚结束，进入下一局
    }
    return { ...this.reveal, cards: [...reveal.cards] };
  }

  nextRound() {
    if (this.phase !== 'reveal' && this.phase !== 'shooting') throw new Error('当前无需进入下一局');
    return this.alivePlayers().length <= 1 ? this.finish() : this.startRound();
  }

  forfeit(id) {
    const player = this.player(id);
    if (!player.connected) return;
    player.connected = false;
    player.hand = [];
    this.log(`${player.name} 已断开连接并离席`);
    if (this.phase === 'ended') return;
    player.alive = false;

    if (this.lastPlay?.player === id) this.lastPlay = null;
    if (this.alivePlayers().length <= 1) {
      this.finish();
    } else if (this.phase === 'playing' && this.current === id) {
      this.current = this.nextAlive(id);
    }
  }

  finish() {
    this.phase = 'ended';
    this.winner = this.alivePlayers()[0]?.id ?? null;
    this.current = null;
    if (this.winner) this.log(`${this.player(this.winner).name} 成为最后的赢家`);
    return this.winner;
  }

  log(message) {
    this.history.push(message);
    if (this.history.length > 80) this.history.shift();
  }

  toJSON() {
    // 纯数据快照（storage 持久化用，避免 random/log 函数无法克隆）
    return {
      round: this.round,
      target: this.target,
      current: this.current,
      lastPlay: this.lastPlay ? { player: this.lastPlay.player, count: this.lastPlay.count, cards: this.lastPlay.cards } : null,
      pile: this.pile.slice(),
      phase: this.phase,
      history: this.history.slice(),
      winner: this.winner,
      reveal: this.reveal ? { ...this.reveal, cards: [...this.reveal.cards], shotsAfter: this.reveal.shotsAfter != null ? this.reveal.shotsAfter : 0 } : null,
      players: this.players.map(function (p) {
        return { id: p.id, name: p.name, avatar: p.avatar, bot: p.bot, alive: p.alive, connected: p.connected, hand: p.hand.slice(), shots: p.shots, liveLeft: p.liveLeft, blankLeft: p.blankLeft, cylinder: p.cylinder ? p.cylinder.slice() : null };
      }),
    };
  }

  viewFor(viewerId) {
    return {
      round: this.round,
      target: this.target,
      current: this.current,
      phase: this.phase,
      shooting: this.phase === 'shooting' && this.reveal ? { shooter: this.reveal.shooter, pending: this.reveal.pending } : null,
      pileCount: this.pile.length,
      lastPlay: this.lastPlay ? { player: this.lastPlay.player, count: this.lastPlay.count } : null,
      winner: this.winner,
      history: [...this.history],
      players: this.players.map((player) => {
        const view = {
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          bot: player.bot,
          alive: player.alive,
          connected: player.connected,
          shots: player.shots,
          liveLeft: player.liveLeft,      // 剩余实弹（公开：大家都能看到弹巢里还有几发实弹）
          blankLeft: player.blankLeft,    // 剩余虚弹
          handCount: player.hand.length,
        };
        if (player.id === viewerId) view.hand = [...player.hand];
        return view;
      }),
    };
  }
}

  function restore(data) {
    var g = new GameEngine(
      data.players.map(function (p) {
        return { id: p.id, name: p.name, avatar: p.avatar, bot: p.bot };
      }),
      { random: Math.random }
    );
    // 覆盖为快照状态（保留方法在原型上）
    g.round = data.round;
    g.target = data.target;
    g.current = data.current;
    g.lastPlay = data.lastPlay;
    g.pile = data.pile.slice();
    g.phase = data.phase;
    g.history = data.history.slice();
    g.winner = data.winner;
    g.reveal = data.reveal;
    data.players.forEach(function (sp, i) {
      var p = g.players[i];
      p.hand = sp.hand.slice();
      p.shots = sp.shots;
      p.liveLeft = sp.liveLeft != null ? sp.liveLeft : 1;
      p.blankLeft = sp.blankLeft != null ? sp.blankLeft : 5;
      p.cylinder = Array.isArray(sp.cylinder) ? sp.cylinder.slice() : null;
      p.alive = sp.alive;
      p.connected = sp.connected;
    });
    return g;
  }

  global.LiarEngine = { RANKS: RANKS, WILD_CARD: WILD_CARD, CARD_NAMES: CARD_NAMES, cardMatchesTarget: cardMatchesTarget, createDeck: createDeck, GameEngine: GameEngine, restore: restore };
  global.LiarEngine.GameEngine.prototype.shoot = GameEngine.prototype.shoot;
})(typeof window !== 'undefined' ? window : globalThis);
