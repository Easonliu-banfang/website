/* 恶魔轮盘 · 3D 主整合（M5）
 * 流程：装弹 → 玩家回合(射自己/射对手/用道具) → AI 回合 → 弹仓空重装 → 轮次推进 → 结算
 * 复用：scene.js(场景) gun.js(霰弹枪) props.js(子弹+道具) demon.js(恶魔) roulette-engine.js(规则)
 *       ../../result-overlay.js(统一结算覆盖层)
 */
import * as THREE from '../lib/three.module.min.js';
import { createScene } from './scene.js';
import { createShotgun } from './gun.js';
import { createShell, createItem, ITEM_CN, ITEM_DESC } from './props.js';
import { createDemon } from './demon.js';
import * as SFX from './sfx.js';
import {
  createGame, shoot, useItem, view, aiDecide, MAX_LIVES,
} from './roulette-engine.js';
import '../../result-overlay.js';   // 挂载 window.ResultOverlay

const $ = (id) => document.getElementById(id);

/* ---------- 场景 ---------- */
const canvas = $('stage');
const app = createScene(canvas);
const { scene, camera, renderer } = app;
window.__roulette = { app };   // 调试句柄

/* ---------- 枪（桌面中央枪座上） ---------- */
const MAT = {
  iron: new THREE.MeshStandardMaterial({ color: 0x2e2f38, roughness: 0.45, metalness: 0.75 }),
  ironDark: new THREE.MeshStandardMaterial({ color: 0x22242c, roughness: 0.5, metalness: 0.6 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.55, metalness: 0.07 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.55, metalness: 0.05 }),
};
const gun = createShotgun(MAT);
const GUN_DESK = new THREE.Vector3(0, app.tableY + 0.085, 0);    // 桌面中央枪座
const GUN_DEMON = new THREE.Vector3(0, 1.0, -1.05);              // 恶魔手中（指着玩家）
const gunTarget = GUN_DESK.clone();
gun.position.copy(GUN_DESK);
scene.add(gun);

/* ---------- 恶魔（对面） ---------- */
const demon = createDemon();
demon.position.set(0, 1.42, -1.3);            // 恶魔侧（对面）
scene.add(demon);

/* ---------- 子弹展示（桌面枪座旁，一排剩余弹） ---------- */
const shellRow = new THREE.Group();
shellRow.position.set(-0.12, app.tableY + 0.055, 0.3);
scene.add(shellRow);
function renderShells(v) {
  // 清掉旧弹
  while (shellRow.children.length) shellRow.remove(shellRow.children[0]);
  const total = v.shell.length;
  if (!total) return;
  const spacing = Math.min(0.045, 0.34 / total);
  v.shell.forEach((live, i) => {
    const s = createShell(live);
    s.rotation.x = Math.PI / 2;                 // 躺平（沿 z 排列
    s.position.set(i * spacing, 0, 0);
    shellRow.add(s);
  });
  // 整排居中
  shellRow.position.x = -0.12 - (total - 1) * spacing / 2 + 0.06;
}

/* ---------- 玩家道具（桌面玩家侧道具格：左右各 2） ---------- */
const itemSlots = new THREE.Group();
scene.add(itemSlots);
function renderItems(v) {
  while (itemSlots.children.length) itemSlots.remove(itemSlots.children[0]);
  const list = v.items.me.slice(0, 4);   // 最多摆 4 个（左右各 2）
  list.forEach((type, i) => {
    const it = createItem(type);
    const side = i < 2 ? -1 : 1;
    const k = i % 2;
    it.position.set(side * (0.3 + k * 0.25), app.tableY + 0.1, 0.52);
    it.scale.setScalar(0.85);
    itemSlots.add(it);
  });
}

/* ---------- 游戏状态 ---------- */
let g = createGame();
let busy = false;          // 动画/AI 进行中，锁输入

/* ---------- HUD ---------- */
function renderLives(container, n, max, who) {
  container.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const d = document.createElement('div');
    d.className = 'life-cell ' + (i < n ? 'on' : 'empty');
    container.appendChild(d);
  }
}
function renderHUD() {
  const v = view(g);
  renderLives($('myLives'), v.lives.me, v.maxLives, 'me');
  renderLives($('foeLives'), v.lives.foe, v.maxLives, 'foe');
  const live = v.shell.filter(Boolean).length;
  const blank = v.shell.length - live;
  $('shellStatus').textContent = '弹仓 ' + v.shell.length + ' 发（实 ' + live + ' / 空 ' + blank + '）';
  renderShells(v);
  renderItems(v);
  renderActions(v);
}
function renderActions(v) {
  const bar = $('actionBar');
  bar.innerHTML = '';
  if (g.over || busy || v.turn !== 'me') {
    bar.innerHTML = '<div class="waiting">恶魔正在抉择…</div>';
    return;
  }
  // 射击按钮（每回合打完一发即换手/保留，始终可射）
  const bSelf = document.createElement('button');
  bSelf.className = 'action-btn';
  bSelf.textContent = '🔫 射自己';
  bSelf.onclick = () => playerShoot('self');
  bar.appendChild(bSelf);

  const bFoe = document.createElement('button');
  bFoe.className = 'action-btn primary';
  bFoe.textContent = '🎯 射恶魔';
  bFoe.onclick = () => playerShoot('foe');
  bar.appendChild(bFoe);

  // 道具按钮：每回合最多 1 个（已用则禁用）
  v.items.me.forEach((type) => {
    const b = document.createElement('button');
    b.className = 'action-btn item' + (v.itemUsedThisTurn ? ' used' : '');
    b.textContent = ITEM_CN[type] || type;
    b.title = ITEM_DESC[type] || '';
    if (v.itemUsedThisTurn) {
      b.disabled = true;
      b.textContent = (ITEM_CN[type] || type) + ' ✓';
    }
    b.onclick = () => playerItem(type);
    bar.appendChild(b);
  });
  if (v.itemUsedThisTurn) {
    const tip = document.createElement('span');
    tip.className = 'waiting small';
    tip.textContent = '本回合已用道具 · 请射击';
    bar.appendChild(tip);
  }
}

/* ---------- 除颤仪电击复活（掉命表现） ---------- */
let defibBusy = false;
function defibRevive(who) {
  if (defibBusy) return;
  defibBusy = true;
  const overlay = document.createElement('div');
  overlay.className = 'defib';
  // 两片贴片（屏幕两侧） + 电击白光 + "噗通"
  overlay.innerHTML =
    '<div class="defib-pad defib-pad-l"></div>' +
    '<div class="defib-pad defib-pad-r"></div>' +
    '<div class="defib-flash"></div>' +
    '<div class="defib-text">⚡ 除颤仪电击 · ' + (who === 'me' ? '你被救回来了' : '恶魔被救回来了') + '</div>';
  document.body.appendChild(overlay);
  SFX.hit();
  setTimeout(() => SFX.fireShot(), 260);   // 电击声
  setTimeout(() => {
    overlay.classList.add('go');
  }, 420);
  setTimeout(() => {
    overlay.remove();
    defibBusy = false;
  }, 1500);
}

/* ---------- 玩家操作 ---------- */
function playerShoot(target) {
  if (busy || g.over) return;
  const who = g.turn;              // 固定为 'me'（玩家回合才调得到
  SFX.uiClick();
  gun.userData.aim(target);        // 枪口朝向（自射/射对手
  setTimeout(() => {
    gun.userData.fire();           // 开枪特效
    SFX.fireShot();                // 枪声
    const r = shoot(g, who, target);
    if (!r) return;
    // 中弹方反应
    if (r.live) {
      if (target === 'foe') demon.userData.hit();
      else flashScreen();
      SFX.hit();                   // 命中闷响
      // 掉命但未死 → 除颤仪电击复活
      if (!r.over) defibRevive(target === 'self' ? 'me' : 'foe');
    } else {
      SFX.blank();                 // 空弹咔嗒
    }
    busy = true;
    renderHUD();
    setTimeout(() => {
      gun.userData.pump();         // 泵动上膛
      SFX.pump();
      afterAction(r);
    }, 620);
  }, 380);
}
function playerItem(type) {
  if (busy || g.over) return;
  const r = useItem(g, 'me', type);
  if (!r.ok) { toast(r.effect); return; }
  SFX.item();
  toast(r.effect);
  renderHUD();
  // 道具不结束回合：用完仍可射击（但本回合不能再用了）
}
function flashScreen() {
  // 自射中弹：屏幕红闪（简易：给 canvas 加一层红色覆盖
  const f = document.createElement('div');
  f.style.cssText = 'position:fixed;inset:0;background:rgba(255,40,40,0.35);pointer-events:none;z-index:99;transition:opacity .3s';
  document.body.appendChild(f);
  setTimeout(() => { f.style.opacity = '0'; }, 60);
  setTimeout(() => f.remove(), 400);
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------- 动作后：切换回合/AI ---------- */
function afterAction(r) {
  renderHUD();
  if (r && r.over) { endGame(); return; }
  // 轮到 AI？
  if (g.turn === 'foe' && !g.over) {
    setTimeout(aiTurn, 900);
  } else {
    gunTarget.copy(GUN_DESK);    // 枪回到桌面中央（交还玩家）
    busy = false;
    renderHUD();
  }
}
function aiTurn() {
  if (g.over) { busy = false; return; }
  const d = aiDecide(g);
  demon.userData.talk();
  SFX.uiClick();
  gunTarget.copy(GUN_DEMON);      // 恶魔拿枪（枪移到它手中，指着你）
  setTimeout(() => {
    if (d.action === 'item') {
      const r = useItem(g, 'foe', d.item);
      if (r.ok) toast('恶魔使用了 ' + (ITEM_CN[d.item] || d.item) + '：' + r.effect);
      SFX.item();
      renderHUD();
      setTimeout(aiTurn, 800);     // 用完道具继续决策（本回合最多 1 个，之后必射击
      return;
    }
    // 射击
    const target = d.target;       // 'self'（自射）| 'foe'（射玩家
    gun.userData.aim(target === 'self' ? 'me' : 'foe');   // 恶魔拿枪（枪口朝向
    setTimeout(() => {
      gun.userData.fire();
      SFX.fireShot();
      const r = shoot(g, 'foe', target);
      if (r && r.live) {
        if (target === 'foe') flashScreen();   // 玩家中弹
        else demon.userData.hit();
        SFX.hit();
        // 掉命但未死 → 除颤仪电击复活
        if (!r.over) defibRevive(target === 'self' ? 'foe' : 'me');
      } else if (r) {
        SFX.blank();
      }
      renderHUD();
      setTimeout(() => {
        gun.userData.pump();
        SFX.pump();
        busy = false;
        afterAction(r);
      }, 600);
    }, 420);
  }, 500);
}

/* ---------- 结算 ---------- */
function endGame() {
  const v = view(g);
  const won = g.winner === 'me';
  const title = won ? '🎉 你赢了！' : '💀 你输了';
  const sub = won ? '恶魔倒下了，你带着钱离开' : '你被永远留在这里';
  const stats = [
    ['你的剩余命数', String(v.lives.me)],
    ['恶魔剩余命数', String(v.lives.foe)],
    ['对局记录', v.log.join('；') || '—'],
  ];
  if (window.ResultOverlay) {
    ResultOverlay.show({
      game: '恶魔轮盘',
      title, sub,
      meRank: won ? 1 : 2,
      me: { name: '你', score: String(v.lives.me), tag: won ? '幸存' : '殒命' },
      players: [
        { name: won ? '你' : '恶魔', score: won ? String(v.lives.me) : String(v.lives.foe), tag: '胜' },
        { name: won ? '恶魔' : '你', score: won ? String(v.lives.foe) : String(v.lives.me), tag: '负' },
      ],
      stats,
      onClose: () => { /* 重开：reload 或 reset（简化：刷新页面） */ },
    });
  }
  // 提供"再来一局"按钮
  const bar = $('actionBar');
  bar.innerHTML = '';
  const again = document.createElement('button');
  again.className = 'action-btn primary';
  again.textContent = '🔄 再来一局';
  again.onclick = () => location.reload();
  bar.appendChild(again);
}

/* ---------- 渲染循环 ---------- */
let last = performance.now();
let started = false;
const camBase = new THREE.Vector3(0, 1.42, 1.78);
const lookDesk = new THREE.Vector3(0, 0.42, -0.35);
const stand = new THREE.Vector3(0, 1.72, 1.9);
const lookSweep = new THREE.Vector3(0.4, 1.1, -0.6);

app.start((tSec) => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {

  if (!started) {
    // 待命：环视房间
    const s = Math.sin(tSec * 0.3) * 0.5;
    camera.position.set(stand.x + s * 0.3, stand.y + Math.cos(tSec * 0.23) * 0.08, stand.z);
    camera.lookAt(new THREE.Vector3(lookSweep.x + s * 0.5, lookSweep.y, lookSweep.z));
  } else {
    // 坐姿
    camera.position.set(camBase.x, camBase.y + Math.sin(tSec * 1.4) * 0.008, camBase.z);
    camera.lookAt(lookDesk);
  }

  // 枪归属：平滑移动到当前持枪方（玩家=桌面中央 / 恶魔=恶魔手中）
  gun.position.lerp(gunTarget, Math.min(1, dt * 4));

  // 各部件动画
  gun.userData.update(dt, tSec);
  demon.userData.update(dt, tSec);
  itemSlots.children.forEach((it) => {
    if (it.userData && it.userData.update) it.userData.update(dt, tSec);
  });

  renderer.render(scene, camera);
  } catch (e) {
    // 渲染异常不阻断流程
    console.warn('render:', e && e.message);
  }
});

/* ---------- 入局 ---------- */
$('btnStart').addEventListener('click', () => {
  started = true;
  $('hud').classList.remove('hidden');
  $('actionBar').classList.remove('hidden');
  $('introScreen').classList.add('fade');
  setTimeout(() => ($('introScreen').style.display = 'none'), 700);
  renderHUD();
  toast('对局开始：你 3 条命 · 恶魔 3 条命 —— 选择射自己或射恶魔');
});

/* 调试：暴露游戏状态 */
window.__game = () => view(g);
