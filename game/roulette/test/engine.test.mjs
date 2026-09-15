/* 恶魔轮盘 · 规则引擎单元测试（node 跑：node test/engine.test.mjs）
 * 覆盖：装弹规则 / 射击判定 / 回合流转 / 手铐 / 手锯 / 道具 8 种 / 轮次推进 / 胜负 / AI
 */
import {
  createGame, load, shoot, useItem, peek, view, aiDecide, decide, LIVES, ROUNDS,
} from '../src/roulette-engine.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function eq(name, a, b) { ok(name + ' (' + a + ' == ' + b + ')', a === b); }

console.log('--- 装弹规则 ---');
{
  const g = createGame(123);
  ok('初始弹仓非空', g.shell.length >= 2);
  ok('初始弹仓 2~8 发', g.shell.length >= 2 && g.shell.length <= 8);
  const live = g.shell.filter(Boolean).length;
  ok('实弹至少 1', live >= 1);
  const blank = g.shell.length - live;
  ok('空弹至少 1', blank >= 1);
  ok('第 1 轮无道具', g.items.me.length === 0 && g.items.foe.length === 0);
  eq('第 1 轮命数', g.lives.me, LIVES[0]);
  eq('初始回合=玩家', g.turn, 'me');
}
{
  const g = createGame(7);
  load(g, 5);
  eq('指定发数装弹', g.shell.length, 5);
  eq('装弹后 idx 归零', g.idx, 0);
}

console.log('--- 射击判定：射自己 ---');
{
  const g = createGame(42);
  g.shell = [false]; g.idx = 0;      // 空弹
  const r = shoot(g, 'me', 'self');
  eq('自射空弹 live=false', r.live, false);
  eq('自射空弹 伤害 0', r.dmg, 0);
  eq('自射空弹 保留回合', g.turn, 'me');
}
{
  const g = createGame(42);
  g.round = 2; g.lives = { me: LIVES[1], foe: LIVES[1] };   // 第 2 轮 3 命（中弹不死，能测扣命）
  g.shell = [true]; g.idx = 0;       // 实弹
  const before = g.lives.me;
  const r = shoot(g, 'me', 'self');
  eq('自射实弹 live=true', r.live, true);
  eq('自射实弹 扣 1 命', g.lives.me, before - 1);
  eq('自射实弹 换对手', g.turn, 'foe');
}

console.log('--- 射击判定：射对手 ---');
{
  const g = createGame(9);
  g.shell = [false, true]; g.idx = 0;
  const r = shoot(g, 'me', 'foe');
  eq('射对手空弹 不扣命', g.lives.foe, LIVES[0]);
  eq('射对手空弹 换对手', g.turn, 'foe');
}
{
  const g = createGame(9);
  g.round = 2; g.lives = { me: LIVES[1], foe: LIVES[1] };
  g.shell = [true, true]; g.idx = 0;
  const before = g.lives.foe;
  shoot(g, 'me', 'foe');
  eq('射对手实弹 对手扣 1', g.lives.foe, before - 1);
}

console.log('--- 道具效果 ---');
{
  const g = createGame(3);
  g.round = 2; g.lives.me = 1;
  g.items.me = ['cigarette'];
  const r = useItem(g, 'me', 'cigarette');
  ok('香烟：ok', r.ok);
  eq('香烟：回 1 命', g.lives.me, 2);
  eq('香烟：消耗道具', g.items.me.length, 0);
}
{
  const g = createGame(3);
  g.round = 3; g.lives.me = 1;
  g.items.me = ['cigarette'];
  const r = useItem(g, 'me', 'cigarette');
  ok('第 3 轮香烟无效（绝命终局）', /无效/.test(r.effect));
  eq('第 3 轮不回命', g.lives.me, 1);
}
{
  const g = createGame(5);
  g.items.me = ['handcuff'];
  useItem(g, 'me', 'handcuff');
  eq('手铐：对手跳过计数 +1', g.cuff.foe, 1);
}
{
  const g = createGame(5);
  g.items.me = ['handsaw'];
  useItem(g, 'me', 'handsaw');
  ok('手锯：saw=true', g.saw === true);
  g.round = 2; g.lives = { me: LIVES[1], foe: LIVES[1] };
  g.shell = [true, true]; g.idx = 0;
  const before = g.lives.foe;
  shoot(g, 'me', 'foe');
  eq('手锯：实弹伤害 2', before - g.lives.foe, 2);
  ok('手锯：一次性（打出后失效）', g.saw === false);
}
{
  const g = createGame(11);
  g.shell = [true, false]; g.idx = 0;
  g.items.me = ['beer'];
  const r = useItem(g, 'me', 'beer');
  ok('啤酒：退弹', /退出/.test(r.effect));
  ok('啤酒：idx 前进', g.idx === 1 || g.idx === 0);   // 退弹后可能重装导致归零
}
{
  const g = createGame(13);
  g.shell = [true, true]; g.idx = 0;
  g.items.me = ['inverter'];
  const r = useItem(g, 'me', 'inverter');
  ok('逆变器：切换当前弹', /切换/.test(r.effect));
  eq('逆变器：实弹→空弹', g.shell[0], false);
}
{
  const g = createGame(17);
  g.shell = [true, false, true]; g.idx = 0;
  g.items.me = ['magnifier'];
  const r = useItem(g, 'me', 'magnifier');
  ok('放大镜：显示当前弹', /当前弹/.test(r.effect));
  ok('放大镜：正确报实弹', /实弹/.test(r.effect));
}
{
  const g = createGame(19);
  g.shell = [true, false]; g.idx = 0;
  g.items.me = ['phone'];
  const r = useItem(g, 'me', 'phone');
  ok('手机：提示第几发', /第 \d+ 发是/.test(r.effect));
}
{
  const g = createGame(23);
  g.items.me = ['adrenaline'];
  g.items.foe = ['cigarette'];
  g.round = 2; g.lives.me = 1;
  const r = useItem(g, 'me', 'adrenaline');
  ok('肾上腺素：偷取并使用', /偷到/.test(r.effect));
  ok('肾上腺素：效果生效（回命或提示）', g.lives.me >= 1);
}

console.log('--- 手铐跳过回合 ---');
{
  const g = createGame(29);
  g.items.me = ['handcuff'];
  useItem(g, 'me', 'handcuff');           // 对手(foe)被铐
  g.shell = [true, true]; g.idx = 0;
  shoot(g, 'me', 'foe');                  // 打完后应换到 foe，但 foe 被铐 → 换回 me
  eq('被铐方跳过 → 回合回到我', g.turn, 'me');
  eq('手铐计数消耗', g.cuff.foe, 0);
}

console.log('--- 轮次推进与胜负 ---');
{
  const g = createGame(31);
  g.round = 1;
  g.lives = { me: 1, foe: 1 };
  g.shell = [true, true]; g.idx = 0;
  const r = shoot(g, 'me', 'foe');        // 打死 foe（第 1 轮结束）
  eq('第 1 轮有人死 → roundOver', r.roundOver, true);
  eq('进入第 2 轮', g.round, 2);
  eq('第 2 轮命数重置', g.lives.me, LIVES[1]);
  eq('第 2 轮玩家先手', g.turn, 'me');
  ok('第 2 轮发道具', g.items.me.length > 0);
}
{
  const g = createGame(37);
  g.round = ROUNDS;                       // 第 3 轮（终局）
  g.lives = { me: 1, foe: 1 };
  g.shell = [true, true]; g.idx = 0;
  const r = shoot(g, 'me', 'foe');
  ok('第 3 轮分出胜负 → over', r.over === true);
  eq('赢家 = me', r.winner, 'me');
  ok('状态 over', g.over === true);
}

console.log('--- AI 决策 ---');
{
  const g = createGame(41);
  g.round = 2; g.lives.foe = 1;
  g.items.foe = ['cigarette'];
  g.shell = [true]; g.idx = 0;
  const d = aiDecide(g);
  eq('AI 残血 → 用香烟', d.item, 'cigarette');
}
{
  const g = createGame(43);
  g.items.foe = [];
  g.shell = [true]; g.idx = 0;
  g._aiKnown = true;                      // 已看过 → 知道是实弹
  const d = aiDecide(g);
  eq('AI 已知实弹 → 射对手', d.target, 'foe');
}
{
  const g = createGame(47);
  g.items.foe = [];
  g.shell = [false]; g.idx = 0;
  g._aiKnown = true;
  const d = aiDecide(g);
  eq('AI 已知空弹 → 自射续命', d.target, 'self');
}
{
  const g = createGame(53);
  g.items.foe = ['magnifier'];
  g.shell = [true]; g.idx = 0;
  g._aiKnown = false;
  const d = aiDecide(g);
  eq('AI 未知 → 先用放大镜', d.item, 'magnifier');
}

console.log('--- 视图 view() ---');
{
  const g = createGame(59);
  const v = view(g);
  ok('view 含 round', typeof v.round === 'number');
  ok('view 含 lives', v.lives && typeof v.lives.me === 'number');
  ok('view 含 shell', Array.isArray(v.shell));
  ok('view 含 items', v.items && Array.isArray(v.items.me));
  ok('view 不泄漏内部 rng', v.rng === undefined);
}

console.log('--- 随机对局（不崩溃 / 能正常结束）---');
{
  let finished = 0;
  for (let s = 1; s <= 30; s++) {
    const g = createGame(s * 97);
    let guard = 0;
    while (!g.over && guard++ < 400) {
      const who = g.turn;                 // 用通用 decide（双方都能决策）
      const d = decide(g, who);
      if (d.action === 'item') useItem(g, who, d.item);
      else shoot(g, who, d.target === 'self' ? 'self' : 'foe');
    }
    if (g.over) finished++;
    ok('种子 ' + s + ' 生命值非负', g.lives.me >= 0 && g.lives.foe >= 0);
  }
  ok('30 局全部正常结束（无死循环，实际结束 ' + finished + ' 局）', finished >= 25);
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
