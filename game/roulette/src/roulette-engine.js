/* 恶魔轮盘 · 规则引擎 —— 纯逻辑（ESM，无 DOM 依赖，可 node 单测）
 *
 * 规则（多来源核对：Wikipedia / 百度百科 / 多个评测）：
 *   - 3 轮；第 1/2/3 轮双方命数 1/3/4（除颤仪充能格）
 *   - 每轮装弹：随机 2~8 发；实弹(红)/空弹(蓝灰) 至少各 1
 *   - 玩家先手
 *   - 射自己：空弹 → 保留回合继续；实弹 → 自己扣 1 命
 *   - 射对手：空弹 → 回合结束换对手；实弹 → 对手扣 1 命（手锯 → 2）
 *   - 弹仓空 → 重新装弹 + 发道具（第 2 轮起）
 *   - 道具（第 2 轮起随机发放；第 2 轮 2 个 / 第 3 轮 4 个，上限 8）
 */

export const ROUNDS = 3;
export const LIVES = [1, 3, 4];
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

/** 建新游戏（自动装第一轮弹） */
export function createGame(seed) {
  const g = {
    rng: makeRng(seed || (Date.now() & 0xffff)),
    round: 1,
    lives: { me: LIVES[0], foe: LIVES[0] },
    shell: [],
    idx: 0,
    turn: 'me',
    items: { me: [], foe: [] },
    saw: false,
    cuff: { me: 0, foe: 0 },
    over: false,
    winner: null,
    log: [],
    _aiKnown: false,
  };
  load(g);
  return g;
}

/** 装弹：随机 2~8 发（n 可指定），实/空至少各 1 */
export function load(g, n) {
  const r = g.rng;
  const total = n || (2 + Math.floor(r() * 7));
  const live = Math.max(1, Math.min(total - 1, 1 + Math.floor(r() * (total - 1))));
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
  return g.shell;
}

function giveItems(g, who, n) {
  for (let i = 0; i < n; i++) {
    const it = ITEM_POOL[Math.floor(g.rng() * ITEM_POOL.length)];
    if (g.items[who].length < 8) g.items[who].push(it);
  }
}

/** 发道具（第 2 轮起：第 2 轮 2 个 / 第 3 轮 4 个） */
export function dealItems(g) {
  if (g.round < 2) return;
  const n = g.round === 2 ? 2 : 4;
  giveItems(g, 'me', n);
  giveItems(g, 'foe', n);
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
 * 射击
 * @param g 游戏状态
 * @param who 开枪方 'me'|'foe'
 * @param target 'self'（射自己）| 'foe'（射对手）
 * @returns { live, dmg, dead, roundOver, over, winner }
 */
export function shoot(g, who, target) {
  if (g.over) return null;
  let cur = peek(g);
  if (cur === null) { load(g); cur = peek(g); }   // 空仓兜底：重装

  const live = cur === true;
  const dmg = live ? (g.saw ? 2 : 1) : 0;
  const shooter = who;
  const victim = target === 'self' ? who : (who === 'me' ? 'foe' : 'me');

  if (live) {
    g.lives[victim] = Math.max(0, g.lives[victim] - dmg);
    g.saw = false;          // 手锯一次性
  }
  g.idx++;

  // 回合流转：射自己 + 空弹 → 保留回合；其余 → 换手
  let next;
  if (target === 'self' && !live) next = shooter;
  else next = shooter === 'me' ? 'foe' : 'me';

  // 手铐：被铐方跳过 → 再换回
  if (g.cuff[next] > 0) {
    g.cuff[next]--;
    next = next === 'me' ? 'foe' : 'me';
  }
  g.turn = next;

  // 弹仓打空 → 重装 + 发道具
  if (g.idx >= g.shell.length) {
    dealItems(g);
    load(g);
  }

  // 有人归零 → 轮次推进 or 游戏结束
  const dead = g.lives.me <= 0 || g.lives.foe <= 0;
  if (dead) {
    const loser = g.lives.me <= 0 ? 'me' : 'foe';
    const winner = loser === 'me' ? 'foe' : 'me';
    g.log.push('第 ' + g.round + ' 轮：' + loser + ' 败');
    if (g.round < ROUNDS) {
      g.round++;
      g.lives = { me: LIVES[g.round - 1], foe: LIVES[g.round - 1] };
      g.items = { me: [], foe: [] };
      g.saw = false;
      g.cuff = { me: 0, foe: 0 };
      dealItems(g);
      load(g);
      g.turn = 'me';        // 每轮玩家先手
      return { live, dmg, dead, roundOver: true, over: false, winner: null };
    }
    g.over = true;
    g.winner = winner;
    g.log.push('第 ' + g.round + ' 轮：' + loser + ' 败 —— ' + winner + ' 获胜');
    return { live, dmg, dead, roundOver: true, over: true, winner };
  }
  return { live, dmg, dead, roundOver: false, over: false };
}

/**
 * 使用道具
 * @returns { ok, effect }
 */
export function useItem(g, who, item) {
  const arr = g.items[who];
  const i = arr.indexOf(item);
  if (g.over || i < 0) return { ok: false, effect: '道具不可用' };
  arr.splice(i, 1);
  return { ok: true, effect: applyEffect(g, who, item) };
}

/* 道具效果核心（useItem 与"偷来即用"共用） */
function applyEffect(g, who, item) {
  const foe = who === 'me' ? 'foe' : 'me';
  switch (item) {
    case 'cigarette': {
      if (g.round === 3) return '第 3 轮绝命终局，香烟无效';
      const cap = LIVES[g.round - 1];
      g.lives[who] = Math.min(cap, g.lives[who] + 1);
      return '恢复 1 命';
    }
    case 'handcuff':
      g.cuff[foe] = (g.cuff[foe] || 0) + 1;
      return '对手跳过 1 回合';
    case 'handsaw':
      g.saw = true;
      return '下次伤害翻倍（本枪 2 命）';
    case 'beer': {
      const c = peek(g);
      if (c === null) return '弹仓空，无法退弹';
      g.idx++;
      if (g.idx >= g.shell.length) { dealItems(g); load(g); }
      return '退出 1 发（' + (c ? '实弹' : '空弹') + '）';
    }
    case 'magnifier': {
      const c = peek(g);
      if (c === null) return '弹仓空';
      return '当前弹：' + (c ? '实弹' : '空弹');
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
      const sub = applyEffect(g, who, stole);   // 偷来即用
      return '偷到 ' + stole + ' 并立即使用 → ' + sub;
    }
    default:
      return '未知道具';
  }
}

/**
 * 通用决策（对任意一方 who='me'|'foe'）——自动/AI 都用它
 * 策略（威胁评估）：
 *   1. 残血且有烟（非绝命轮）→ 回血
 *   2. 未知当前弹且有放大镜 → 先查看
 *   3. 已知实弹 → 有锯先锯（翻倍），否则射对手
 *   4. 已知空弹 → 自射（保留回合）
 * @returns { action:'shoot'|'item', target?, item?, reason }
 */
export function decide(g, who) {
  const items = g.items[who] || [];
  const has = (n) => items.indexOf(n) >= 0;
  const cur = peek(g);

  if (g.round !== 3 && g.lives[who] <= 1 && has('cigarette')) {
    return { action: 'item', item: 'cigarette', reason: '残血回命' };
  }
  if (cur === null) return { action: 'shoot', target: 'self', reason: '空仓兜底' };

  if (!g._aiKnown && has('magnifier')) {
    g._aiKnown = true;
    return { action: 'item', item: 'magnifier', reason: '查看当前弹' };
  }

  if (cur === true) {
    if (has('handsaw')) return { action: 'item', item: 'handsaw', reason: '实弹 + 锯 → 翻倍伤害' };
    return { action: 'shoot', target: 'foe', reason: '实弹射对手' };
  }
  return { action: 'shoot', target: 'self', reason: '空弹自射续命' };
}

/** AI（恶魔 = foe）决策：decide 的专用别名 */
export function aiDecide(g) {
  return decide(g, 'foe');
}

/** 公开状态（给 UI 渲染） */
export function view(g) {
  return {
    round: g.round,
    maxLives: LIVES[g.round - 1],
    lives: { me: g.lives.me, foe: g.lives.foe },
    shell: g.shell.slice(g.idx),
    turn: g.turn,
    items: { me: g.items.me.slice(), foe: g.items.foe.slice() },
    saw: g.saw,
    cuff: { me: g.cuff.me, foe: g.cuff.foe },
    over: g.over,
    winner: g.winner,
    log: g.log.slice(),
  };
}
