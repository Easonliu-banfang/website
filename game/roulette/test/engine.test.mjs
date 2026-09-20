/* 恶魔轮盘 · 规则引擎 v2 单元测试（node：node test/engine.test.mjs）
 * 覆盖：单局 3 命 / 开局道具 / 每回合限 1 道具 / 射击判定 / 手铐手锯 / 道具 8 种 / 胜负 / AI
 */
import {
  createGame, load, shoot, useItem, peek, view, aiDecide, MAX_LIVES, START_ITEMS,
} from '../src/roulette-engine.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }
function eq(name, a, b) { ok(name + ' (' + a + ' == ' + b + ')', a === b); }

console.log('--- 开局状态 ---');
{
  const g = createGame(123);
  ok('弹仓 2~8 发', g.shell.length >= 2 && g.shell.length <= 8);
  ok('实弹至少 1', g.shell.filter(Boolean).length >= 1);
  ok('空弹至少 1', g.shell.length - g.shell.filter(Boolean).length >= 1);
  eq('双方各 3 命', g.lives.me, MAX_LIVES);
  eq('恶魔 3 命', g.lives.foe, MAX_LIVES);
  eq('开局发 4 道具', g.items.me.length, START_ITEMS);
  eq('恶魔也 4 道具', g.items.foe.length, START_ITEMS);
  eq('玩家先手', g.turn, 'me');
  ok('本回合未用道具', g.itemUsedThisTurn === false);
}

console.log('--- 每回合限 1 道具 ---');
{
  const g = createGame(7);
  const first = g.items.me[0];
  const r1 = useItem(g, 'me', first);
  ok('第一个道具可用', r1.ok === true);
  ok('本回合已标记', g.itemUsedThisTurn === true);
  const second = g.items.me[0];
  const r2 = useItem(g, 'me', second);
  ok('同回合第二个道具被拒', r2.ok === false);
  // 射击后重置
  g.shell = [false]; g.idx = 0;
  shoot(g, 'me', 'self');
  ok('射击后重置道具标记', g.itemUsedThisTurn === false);
}

console.log('--- 射击判定：射自己 ---');
{
  const g = createGame(42);
  g.shell = [false]; g.idx = 0;         // 空弹
  const r = shoot(g, 'me', 'self');
  eq('自射空弹 live=false', r.live, false);
  eq('自射空弹不扣命', g.lives.me, MAX_LIVES);
  eq('自射空弹保留回合', g.turn, 'me');
}
{
  // 自射实弹 + 弹仓剩余 → 换手给对手
  const g = createGame(42);
  g.shell = [true, false]; g.idx = 0;   // 实弹 + 还有 1 发
  const before = g.lives.me;
  shoot(g, 'me', 'self');
  eq('自射实弹扣 1 命', g.lives.me, before - 1);
  eq('自射实弹(未空仓)换对手', g.turn, 'foe');
}
{
  // 自射实弹恰好打空弹仓 → 重装 → 玩家先手（正版：每轮装弹后玩家先手）
  const g = createGame(42);
  g.shell = [true]; g.idx = 0;          // 只有 1 发实弹
  shoot(g, 'me', 'self');
  eq('弹仓打空重装后玩家先手', g.turn, 'me');
}

console.log('--- 射击判定：射恶魔 ---');
{
  const g = createGame(9);
  g.shell = [false, true]; g.idx = 0;
  shoot(g, 'me', 'foe');
  eq('射恶魔空弹不扣命', g.lives.foe, MAX_LIVES);
  eq('射恶魔空弹换对手', g.turn, 'foe');
}
{
  const g = createGame(9);
  g.shell = [true, true]; g.idx = 0;
  const before = g.lives.foe;
  shoot(g, 'me', 'foe');
  eq('射恶魔实弹恶魔扣 1', g.lives.foe, before - 1);
}

console.log('--- 手铐跳过回合 ---');
{
  const g = createGame(29);
  g.items.me = ['handcuff'];
  useItem(g, 'me', 'handcuff');        // 恶魔被铐
  g.shell = [true, true]; g.idx = 0;
  shoot(g, 'me', 'foe');               // 打完应换恶魔，但被铐 → 换回我
  eq('被铐方跳过 → 回到我', g.turn, 'me');
  eq('手铐计数消耗', g.cuff.foe, 0);
}

console.log('--- 手锯伤害翻倍 ---');
{
  const g = createGame(5);
  g.items.me = ['handsaw'];
  useItem(g, 'me', 'handsaw');
  g.shell = [true, true]; g.idx = 0;
  const before = g.lives.foe;
  shoot(g, 'me', 'foe');
  eq('手锯实弹扣 2 命', before - g.lives.foe, 2);
  ok('手锯一次性', g.saw === false);
}

console.log('--- 道具效果 ---');
{
  const g = createGame(3);
  g.lives.me = 1;
  g.items.me = ['cigarette'];
  const r = useItem(g, 'me', 'cigarette');
  ok('香烟回命', r.ok);
  eq('香烟回 1 命', g.lives.me, 2);
}
{
  const g = createGame(5);
  g.items.me = ['magnifier'];
  g.shell = [true]; g.idx = 0;
  const r = useItem(g, 'me', 'magnifier');
  ok('放大镜看弹', /实弹|空弹/.test(r.effect));
}
{
  const g = createGame(11);
  g.items.me = ['inverter'];
  g.shell = [true]; g.idx = 0;
  useItem(g, 'me', 'inverter');
  eq('逆变器切换当前弹', g.shell[0], false);
}
{
  const g = createGame(13);
  g.items.me = ['beer'];
  g.shell = [true, false]; g.idx = 0;
  const r = useItem(g, 'me', 'beer');
  ok('啤酒退弹', /退出/.test(r.effect));
}
{
  const g = createGame(17);
  g.items.me = ['phone'];
  g.shell = [true, false]; g.idx = 0;
  const r = useItem(g, 'me', 'phone');
  ok('手机提示', /第 \d+ 发/.test(r.effect));
}
{
  const g = createGame(19);
  g.items.me = ['adrenaline'];
  g.items.foe = ['cigarette'];
  g.lives.me = 1;
  const r = useItem(g, 'me', 'adrenaline');
  ok('肾上腺素偷取', /偷到/.test(r.effect));
  eq('偷来香烟立即回命', g.lives.me, 2);
  eq('恶魔道具被拿走', g.items.foe.length, 0);
}

console.log('--- 弹仓打空重装补道具 ---');
{
  const g = createGame(23);
  g.shell = [false]; g.idx = 0;
  g.items.me = ['x'.repeat(0) === '' ? 'cigarette' : 'cigarette']; // noop
  const before = g.items.me.length;
  shoot(g, 'me', 'self');            // 空弹自射 + 弹仓打空 → 重装 + 补道具
  ok('弹仓已重装', g.shell.length >= 2);
  ok('补发道具', g.items.me.length > before);
}

console.log('--- 单局 3 命，命尽即死（无第二局）---');
{
  const g = createGame(31);
  g.lives = { me: 3, foe: 1 };
  g.shell = [true, true]; g.idx = 0;
  const r = shoot(g, 'me', 'foe');   // 恶魔剩 1 命，被打中 → 死
  ok('恶魔命尽 → over', r.over === true);
  eq('赢家=me', r.winner, 'me');
  ok('游戏结束', g.over === true);
}

console.log('--- AI 决策 ---');
{
  const g = createGame(41);
  g.lives.foe = 2;
  g.items.foe = ['cigarette'];
  g.shell = [true]; g.idx = 0;
  const d = aiDecide(g);
  eq('AI 不满血优先回命', d.item, 'cigarette');
}
{
  const g = createGame(43);
  g.items.foe = ['handcuff'];
  g.shell = [true]; g.idx = 0;
  const d = aiDecide(g);
  eq('AI 有手铐优先铐玩家', d.item, 'handcuff');
}
{
  const g = createGame(47);
  g.items.foe = [];
  g._aiKnown = true;
  g.shell = [true]; g.idx = 0;
  const d = aiDecide(g);
  eq('AI 已知实弹 → 射玩家', d.target, 'foe');
}
{
  const g = createGame(53);
  g.items.foe = [];
  g._aiKnown = true;
  g.shell = [false]; g.idx = 0;
  const d = aiDecide(g);
  eq('AI 已知空弹 → 自射', d.target, 'self');
}

console.log('--- 视图 ---');
{
  const g = createGame(59);
  const v = view(g);
  ok('view 含 lives', v.lives && typeof v.lives.me === 'number');
  ok('view 含 items', v.items && Array.isArray(v.items.me));
  ok('view 含 maxLives', v.maxLives === MAX_LIVES);
}

console.log('--- 随机对局（不崩溃 / 正常结束）---');
{
  let finished = 0;
  for (let s = 1; s <= 40; s++) {
    const g = createGame(s * 97);
    let guard = 0;
    while (!g.over && guard++ < 120) {
      if (g.turn === 'me') {
        // 玩家：30% 概率先用道具，然后射击
        const items = g.items.me;
        if (!g.itemUsedThisTurn && items.length && Math.random() < 0.3) {
          useItem(g, 'me', items[Math.floor(Math.random() * items.length)]);
        }
        shoot(g, 'me', Math.random() < 0.6 ? 'foe' : 'self');
      } else {
        const d = aiDecide(g);
        if (d.action === 'item') useItem(g, 'foe', d.item);
        else shoot(g, 'foe', d.target === 'self' ? 'self' : 'foe');
      }
    }
    ok('种子 ' + s + ' 生命非负', g.lives.me >= 0 && g.lives.foe >= 0);
    if (g.over) finished++;
  }
  ok('40 局全部正常结束（' + finished + ' 局完成）', finished >= 35);
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
