/* 恶魔轮盘 · 规则引擎 v2 —— 纯逻辑（ESM，无 DOM 依赖，可 node 单测）
 *
 * 规则（按用户确认 + 网络核对）：
 *   - 单局制：双方各 3 条命（除颤仪充能格），打光即死，无第二局
 *   - 开局装弹：随机 2~8 发；实弹(红)/空弹(蓝) 至少各 1；数量公开、顺序隐藏
 *   - 每局开局：双方各发 4 个道具（放到桌上 4 格）
 *   - 每回合：可先选用 1 个道具（最多 1 个），再选择射自己 or 射恶魔，打 1 发
 *   - 打中自己：空弹 → 保留回合继续；实弹 → 自己掉 1 命，换对手
 *   - 打中恶魔：空弹 → 换对手；实弹 → 恶魔掉 1 命，换对手
 *   - 掉命有除颤仪电击复活（UI 表现）；3 命全失 → 死
 *   - 弹仓打空 → 重新装弹 + 双方补发道具
 *   - 道具：magnifier 放大镜 / cigarette 香烟 / handcuff 手铐 / handsaw 手锯
 *          beer 啤酒 / adrenaline 肾上腺素(偷来立即用) / inverter 逆变器 / phone 手机
 */

export const MAX_LIVES = 3;          // 双方各 3 条命
export const START_ITEMS = 4;        // 开局各发 4 个道具
export const ITEM_POOL = [
  'magnifier', 'cigarette', 'handcuff', 'handsaw',
  'beer', 'adrenaline', 'inverter', 'phone',
];

/* 简易可种子随机（xorshift32）—— 测试可复现 */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** 建新游戏（自动装弹 + 开局发 4 道具） */
export function createGame(seed) {
  const g = {
    rng: makeRng(seed || (Date.now() & 0xffff)),
    lives: { me: MAX_LIVES, foe: MAX_LIVES },
    shell: [],
    idx: 0,
    turn: 'me',
    items: { me: [], foe: [] },
    itemUsedThisTurn: false,   // 本回合是否已用道具（每回合限 1 个）
    saw: false,
    cuff: { me: 0, foe: 0 },
    over: false,
    winner: null,
    log: [],
    _aiKnown: false,
    _aiActed: false,           // AI 本回合是否已动作（道具/射击）
    loadSeq: 0,                // 装弹序号（前端导轨展示触发）
    loadInfo: null,            // 本轮装弹信息 { total, live, blank }
  };
  dealItems(g);
  load(g, 3, 1);              // 正版：首局固定 1 实 2 虚（此后每轮 2~8 随机）
  return g;
}

/** 装弹：随机 2~8 发（n 可指定总数，fixedLive 可指定实弹数），实/空至少各 1 */
export function load(g, n, fixedLive) {
  const r = g.rng;
  const total = n || (2 + Math.floor(r() * 7));   // 正版：每轮 2~8 发随机
  // 正版：实弹数在 1..N-1 之间随机（至少各 1）；可固定（如首局 1 实 2 虚）
  const live = (fixedLive != null)
    ? Math.max(1, Math.min(total - 1, fixedLive))
    : Math.max(1, Math.min(total - 1, 1 + Math.floor(r() * (total - 1))));
  const arr = new Array(total).fill(false);
  const pos = [];
  for (let i = 0; i < total; i++) pos.push(i);
  for (let i = pos.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = pos[i]; pos[i] = pos[j]; pos[j] = t;
  }
  for (let i = 0; i < live; i++) arr[pos[i]] = true;
  g.shell = arr;
  g.idx = 0;
  g._aiKnown = false;
  g.loadSeq = (g.loadSeq || 0) + 1;      // 装弹序号（前端据此触发导轨展示）
  g.loadInfo = { total, live, blank: total - live };   // 公开信息：本轮实/空数量
  return g.shell;
}

function giveItems(g, who, n) {
  for (let i = 0; i < n; i++) {
    const it = ITEM_POOL[Math.floor(g.rng() * ITEM_POOL.length)];
    if (g.items[who].length < 8) g.items[who].push(it);
  }
}

/** 发道具：开局各 4 个；弹仓重装时各补发 2 个 */
export function dealItems(g) {
  giveItems(g, 'me', START_ITEMS);
  giveItems(g, 'foe', START_ITEMS);
}

/** 当前膛内弹：true=实弹，false=空弹，null=弹仓空 */
export function peek(g) {
  return g.idx < g.shell.length ? g.shell[g.idx] : null;
}

/** 剩余弹数（含当前这发） */
export function remains(g) {
  return Math.max(0, g.shell.length - g.idx);
}

/** 剩余弹中实弹占比 0..1（AI 用） */
export function liveRatio(g) {
  const rest = g.shell.slice(g.idx);
  if (!rest.length) return 0;
  return rest.filter(Boolean).length / rest.length;
}

/**
 * 射击（每回合只能打一发）
 * @param g 游戏状态
 * @param who 开枪方 'me'|'foe'
 * @param target 'self'（射自己）| 'foe'（射对手）
 * @returns { live, dmg, dead, over, winner }
 */
export function shoot(g, who, target) {
  if (g.over) return null;
  let cur = peek(g);
  if (cur === null) { load(g); giveItems(g, 'me', 2); giveItems(g, 'foe', 2); cur = peek(g); }

  const live = cur === true;
  const dmg = live ? (g.saw ? 2 : 1) : 0;
  const victim = target === 'self' ? who : (who === 'me' ? 'foe' : 'me');

  if (live) {
    g.lives[victim] = Math.max(0, g.lives[victim] - dmg);
    g.saw = false;          // 手锯一次性
  }
  g.idx++;

  // 回合流转：射自己 + 空弹 → 保留回合；其余 → 换手
  let next;
  if (target === 'self' && !live) next = who;
  else next = who === 'me' ? 'foe' : 'me';

  // 手铐：被铐方跳过 → 再换回
  if (g.cuff[next] > 0) {
    g.cuff[next]--;
    next = next === 'me' ? 'foe' : 'me';
  }
  g.turn = next;

  // 重置回合标记（每回合限 1 道具）
  g.itemUsedThisTurn = false;
  g._aiActed = false;
  g._aiKnown = false;      // 下一回合重新用放大镜（信息不跨回合记忆）

  // 弹仓打空 → 重装 + 补发道具；正版规则：新负载从玩家先手
  if (g.idx >= g.shell.length) {
    load(g);
    giveItems(g, 'me', 2);
    giveItems(g, 'foe', 2);
    g.turn = 'me';          // 正版：每次装弹后玩家先手
  }

  // 有人归零 → 直接结束（无第二局）
  const dead = g.lives.me <= 0 || g.lives.foe <= 0;
  if (dead) {
    const loser = g.lives.me <= 0 ? 'me' : 'foe';
    g.over = true;
    g.winner = loser === 'me' ? 'foe' : 'me';
    g.log.push(loser + ' 命尽 —— ' + g.winner + ' 获胜');
    return { live, dmg, dead, over: true, winner: g.winner };
  }
  return { live, dmg, dead, over: false };
}

/**
 * 使用道具（每回合最多 1 个；用了之后本回合不能再用，但可以射击）
 * @returns { ok, effect }
 */
export function useItem(g, who, item) {
  const arr = g.items[who];
  const i = arr.indexOf(item);
  if (g.over) return { ok: false, effect: '游戏已结束' };
  if (g.itemUsedThisTurn && g.turn === who) return { ok: false, effect: '本回合已用道具，最多 1 个' };
  if (i < 0) return { ok: false, effect: '道具不可用' };
  arr.splice(i, 1);
  g.itemUsedThisTurn = true;   // 本回合已用
  return { ok: true, effect: applyEffect(g, who, item) };
}

/* 道具效果核心（useItem 与"偷来即用"共用） */
function applyEffect(g, who, item) {
  const foe = who === 'me' ? 'foe' : 'me';
  switch (item) {
    case 'cigarette': {
      const cap = MAX_LIVES;
      if (g.lives[who] >= cap) return '命数已满，无法恢复';
      g.lives[who] = Math.min(cap, g.lives[who] + 1);
      return '恢复 1 条命';
    }
    case 'handcuff':
      g.cuff[foe] = (g.cuff[foe] || 0) + 1;
      return '对手跳过 1 回合';
    case 'handsaw':
      g.saw = true;
      return '下次伤害翻倍（2 命）';
    case 'beer': {
      const c = peek(g);
      if (c === null) return '弹仓空，无法退弹';
      g.idx++;
      if (g.idx >= g.shell.length) { load(g); giveItems(g, 'me', 2); giveItems(g, 'foe', 2); }
      return '退出 1 发（' + (c ? '实弹' : '空弹') + '）';
    }
    case 'magnifier': {
      const c = peek(g);
      if (c === null) return '弹仓空';
      return '当前膛内是' + (c ? '实弹' : '空弹');
    }
    case 'inverter': {
      const c = peek(g);
      if (c === null) return '弹仓空，无法切换';
      g.shell[g.idx] = !c;
      return '切换当前弹（实↔空）';
    }
    case 'phone': {
      const n = g.shell.length;
      if (!n) return '弹仓空';
      const k = Math.floor(g.rng() * n);
      return '第 ' + (k + 1) + ' 发是 ' + (g.shell[k] ? '实弹' : '空弹');
    }
    case 'adrenaline': {
      const fa = g.items[foe];
      if (!fa || !fa.length) return '对手无道具可偷';
      const stole = fa.pop();
      const sub = applyEffect(g, who, stole);   // 偷来立即使用
      return '偷到' + stole + '并立即使用 → ' + sub;
    }
    default:
      return '未知道具';
  }
}

/**
 * AI（恶魔）决策（foe）：每回合最多 1 道具，然后射击
 * @returns { action:'item'|'shoot', item?, target?, reason }
 */
export function aiDecide(g) {
  const who = 'foe';
  const items = g.items[who] || [];
  const has = (n) => items.indexOf(n) >= 0;
  // 重要：AI 不允许偷看膛内弹序。只有「用过放大镜」本回合才知道当前这发是什么
  const known = !!g._aiKnown;
  const cur = known ? peek(g) : null;      // 未看→不读（防止 AI 开挂）
  const ratio = liveRatio(g);
  const rest = remains(g);

  // 回合内已用道具 → 射击（有信息按信息，无信息按概率）
  if (g.itemUsedThisTurn) {
    if (known && cur === true) return { action: 'shoot', target: 'foe', reason: '已知实弹→射玩家' };
    if (known && cur === false) return { action: 'shoot', target: 'self', reason: '已知空弹→自射续命' };
    // 未知：实弹概率高 → 赌射玩家；否则自射
    if (ratio >= 0.45) return { action: 'shoot', target: 'foe', reason: '未知·实弹率高→赌' };
    return { action: 'shoot', target: 'self', reason: '未知·空弹率高→自射' };
  }

  // 残血且有烟 → 回命
  if (g.lives[who] < MAX_LIVES && has('cigarette')) {
    return { action: 'item', item: 'cigarette', reason: '回命' };
  }

  // 手铐：有就优先用（跳过玩家回合）
  if (has('handcuff') && g.cuff.me === 0) {
    return { action: 'item', item: 'handcuff', reason: '铐住玩家' };
  }

  // 没看过当前弹且有放大镜 → 先看（获得合法信息）
  if (!known && has('magnifier') && rest > 0) {
    g._aiKnown = true;
    return { action: 'item', item: 'magnifier', reason: '查看当前弹' };
  }

  // 弹仓空兜底
  if (rest <= 0) return { action: 'shoot', target: 'self', reason: '空仓兜底' };

  // 已知当前弹（放大镜看的）
  if (known && cur === true) {
    if (has('handsaw') && !g.saw) return { action: 'item', item: 'handsaw', reason: '实弹+锯→翻倍' };
    return { action: 'shoot', target: 'foe', reason: '实弹射玩家' };
  }
  if (known && cur === false) {
    return { action: 'shoot', target: 'self', reason: '空弹自射续命' };
  }

  // 未知（大多数情况）：纯概率决策，和玩家信息对等
  //   实弹占比高 → 把风险给玩家（射玩家）；低 → 自射博续回合
  if (has('handsaw') && !g.saw && ratio >= 0.5) {
    return { action: 'item', item: 'handsaw', reason: '实弹率高+锯→翻倍' };
  }
  if (ratio >= 0.5) return { action: 'shoot', target: 'foe', reason: '未知·实弹率' + Math.round(ratio * 100) + '%→射玩家' };
  return { action: 'shoot', target: 'self', reason: '未知·空弹率高→自射' };
}

/** 公开状态（给 UI 渲染） */
export function view(g) {
  const rest = g.shell.slice(g.idx);
  const liveLeft = rest.filter(Boolean).length;
  const blankLeft = rest.length - liveLeft;
  return {
    maxLives: MAX_LIVES,
    lives: { me: g.lives.me, foe: g.lives.foe },
    // 只公开「剩余实弹/空弹数量」——顺序保密，谁也预知不了下一发
    shellLeft: { live: liveLeft, blank: blankLeft, total: rest.length },
    shellTotal: g.shell.length,          // 本轮装弹总数（导轨展示用）
    loadSeq: g.loadSeq || 0,
    loadInfo: g.loadInfo ? { ...g.loadInfo } : null,
    turn: g.turn,
    items: { me: g.items.me.slice(), foe: g.items.foe.slice() },
    itemUsedThisTurn: g.itemUsedThisTurn,
    saw: g.saw,
    cuff: { me: g.cuff.me, foe: g.cuff.foe },
    over: g.over,
    winner: g.winner,
    log: g.log.slice(),
  };
}
