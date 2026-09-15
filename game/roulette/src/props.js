/* 恶魔轮盘 · 子弹 + 8 种道具（程序化精细建模）
 *   - createShell(isLive)：红色实弹 / 蓝色空弹（12 号霰弹：黄铜弹壳 + 弹头）
 *   - createItem(type)：8 种道具（放大镜/香烟/手铐/手锯/啤酒/肾上腺素/感应调整器/手机）
 * 所有道具带 userData.update(dt, t)：悬浮 + 缓慢自转（放在桌上道具格或手边）
 */
import * as THREE from '../lib/three.module.min.js';

/* ---------- 子弹 ---------- */
export function createShell(isLive) {
  const g = new THREE.Group();
  // 黄铜弹壳（金属）
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.35, metalness: 0.85 });
  const shellCase = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.0115, 0.038, 14), caseMat);
  g.add(shellCase);
  // 弹壳底座（金属环）
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.006, 14),
    new THREE.MeshStandardMaterial({ color: 0x8a6f2c, roughness: 0.4, metalness: 0.8 }));
  rim.position.y = -0.019;
  g.add(rim);
  // 弹头（红色=实弹 / 蓝色=空弹）
  const tipMat = new THREE.MeshStandardMaterial({
    color: isLive ? 0xc92f2f : 0x4f7fb5,
    roughness: isLive ? 0.45 : 0.6,
    metalness: isLive ? 0.15 : 0.05,
    emissive: isLive ? 0x4a0f0f : 0x14243a,
    emissiveIntensity: isLive ? 0.5 : 0.35,
  });
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.011, 0.016, 14), tipMat);
  tip.position.y = 0.026;
  g.add(tip);
  // 弹头顶（略收口）
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), tipMat);
  cap.position.y = 0.034;
  g.add(cap);
  // 空弹：顶部封口片（塑料感：灰色薄片）
  if (!isLive) {
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.002, 14),
      new THREE.MeshStandardMaterial({ color: 0x6f7a86, roughness: 0.8 }));
    seal.position.y = 0.042;
    g.add(seal);
  } else {
    // 实弹：底火（中心小点）
    const primer = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.001, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.9, roughness: 0.3 }));
    primer.position.y = -0.022;
    g.add(primer);
  }
  g.userData.isLive = !!isLive;
  return g;
}

/* ---------- 8 种道具 ---------- */
export function createItem(type) {
  const g = new THREE.Group();
  const M = (c, r, m, e) => new THREE.MeshStandardMaterial({
    color: c, roughness: r, metalness: m,
    emissive: e || 0x000000, emissiveIntensity: e ? 0.55 : 0,
  });

  switch (type) {
    /* 放大镜：金属环 + 透明镜片 + 木柄 */
    case 'magnifier': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 10, 22),
        new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.9 }));
      g.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 22),
        new THREE.MeshPhysicalMaterial({
          color: 0xbfe4ff, transparent: true, opacity: 0.42,
          roughness: 0.05, metalness: 0, transmission: 0.85, thickness: 0.004,
        }));
      g.add(lens);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.055, 10), M(0x5a3a1c, 0.6, 0.05));
      handle.position.y = -0.055;
      g.add(handle);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 10),
        new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.85 }));
      collar.position.y = -0.032;
      g.add(collar);
      break;
    }
    /* 香烟：白杆 + 橙滤嘴 + 烟灰 */
    case 'cigarette': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.062, 12), M(0xf2ece0, 0.85, 0));
      g.add(body);
      const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.0057, 0.0057, 0.02, 12), M(0xd8933a, 0.8, 0));
      filter.position.y = -0.041;
      g.add(filter);
      const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.0053, 0.0053, 0.008, 12), M(0x3a3330, 0.95, 0));
      ash.position.y = 0.034;
      g.add(ash);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff4400, emissiveIntensity: 1.3 }));
      ember.position.y = 0.04;
      g.add(ember);
      break;
    }
    /* 手铐：双环 + 链节 */
    case 'handcuff': {
      const mat = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.25, metalness: 0.95 });
      for (const dx of [-0.022, 0.022]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0035, 8, 18), mat);
        ring.rotation.x = Math.PI / 2;
        ring.position.x = dx;
        g.add(ring);
      }
      // 中间链（3 节小环）
      for (let i = 0; i < 3; i++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.005, 0.0016, 6, 10), mat);
        link.rotation.x = Math.PI / 2;
        link.position.set(-0.008 + i * 0.008, 0, 0);
        g.add(link);
      }
      break;
    }
    /* 手锯：锯齿金属片 + 木柄 */
    case 'handsaw': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.026, 0.002),
        new THREE.MeshStandardMaterial({ color: 0xc4c9d2, roughness: 0.2, metalness: 0.95 }));
      g.add(blade);
      // 锯齿（下缘一排小三角）
      for (let i = 0; i < 9; i++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.0035, 0.006, 4),
          new THREE.MeshStandardMaterial({ color: 0xd6dbe4, roughness: 0.2, metalness: 0.95 }));
        tooth.rotation.z = Math.PI;
        tooth.position.set(-0.033 + i * 0.0085, -0.015, 0);
        g.add(tooth);
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.024, 0.012), M(0x6b3f1e, 0.65, 0.05));
      handle.position.set(0.052, -0.002, 0);
      g.add(handle);
      break;
    }
    /* 啤酒：易拉罐 + 拉环 */
    case 'beer': {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.058, 16),
        new THREE.MeshStandardMaterial({ color: 0x2f6f3a, roughness: 0.3, metalness: 0.75 }));
      g.add(can);
      // 标签带（金色）
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0173, 0.0173, 0.03, 16), M(0xd9b34a, 0.5, 0.3));
      label.position.y = -0.004;
      g.add(label);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.017, 0.004, 16),
        new THREE.MeshStandardMaterial({ color: 0xa8adb6, roughness: 0.25, metalness: 0.95 }));
      top.position.y = 0.03;
      g.add(top);
      const tab = new THREE.Mesh(new THREE.TorusGeometry(0.005, 0.0012, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xc0c6cf, roughness: 0.3, metalness: 0.9 }));
      tab.rotation.x = Math.PI / 2;
      tab.position.set(0, 0.033, 0);
      g.add(tab);
      break;
    }
    /* 肾上腺素：注射器（针管+活塞+针头） */
    case 'adrenaline': {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.05, 12),
        new THREE.MeshPhysicalMaterial({
          color: 0xdfe9f2, transparent: true, opacity: 0.5,
          roughness: 0.1, transmission: 0.8, thickness: 0.003,
        }));
      g.add(barrel);
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.03, 12),
        new THREE.MeshStandardMaterial({ color: 0xff5566, emissive: 0xcc2233, emissiveIntensity: 0.7, roughness: 0.3 }));
      liquid.position.y = -0.008;
      g.add(liquid);
      const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.014, 10), M(0xe8e8e8, 0.5, 0.1));
      plunger.position.y = 0.03;
      g.add(plunger);
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.02, 6),
        new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.2, metalness: 0.95 }));
      needle.position.y = -0.034;
      g.add(needle);
      break;
    }
    /* 感应调整器：小金属盒 + 旋钮 + 指示灯 */
    case 'inverter': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.024), M(0x39404e, 0.45, 0.6));
      g.add(box);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12), M(0xb0b6c2, 0.3, 0.85));
      knob.rotation.x = Math.PI / 2;
      knob.position.set(-0.012, 0, 0.016);
      g.add(knob);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x66ff99, emissive: 0x22cc66, emissiveIntensity: 1.6 }));
      led.position.set(0.014, 0.006, 0.014);
      g.add(led);
      // 散热槽
      for (let i = 0; i < 3; i++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.002), M(0x1e232c, 0.8, 0.3));
        slot.position.set(0, 0.012, -0.012 + i * 0.006);
        g.add(slot);
      }
      break;
    }
    /* 一次性手机：扁机身 + 发光屏 */
    case 'phone': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.058, 0.008), M(0x22262f, 0.5, 0.4));
      g.add(body);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.045, 0.002),
        new THREE.MeshStandardMaterial({
          color: 0x9fe8c8, emissive: 0x35c98a, emissiveIntensity: 0.9, roughness: 0.25,
        }));
      screen.position.z = 0.005;
      g.add(screen);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.001, 10), M(0x4a505c, 0.6, 0.3));
      btn.rotation.x = Math.PI / 2;
      btn.position.set(0, -0.024, 0.005);
      g.add(btn);
      break;
    }
    default: {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), M(0x888888, 0.6, 0.2));
      g.add(cube);
      break;
    }
  }

  // 道具通用动画：悬浮 + 自转
  const baseY = g.position.y;
  g.userData.type = type;
  g.userData.update = function (dt, t) {
    g.rotation.y += dt * 0.8;
    g.position.y = baseY + Math.sin(t * 2 + baseY * 12) * 0.006;
  };

  return g;
}

/* 道具中文名（UI 用） */
export const ITEM_CN = {
  magnifier: '放大镜',
  cigarette: '香烟',
  handcuff: '手铐',
  handsaw: '手锯',
  beer: '啤酒',
  adrenaline: '肾上腺素',
  inverter: '感应调整器',
  phone: '一次性手机',
};

/* 道具简要说明（UI 用） */
export const ITEM_DESC = {
  magnifier: '查看当前膛内是实弹还是空弹',
  cigarette: '恢复 1 点命数（第 3 轮无效）',
  handcuff: '对手跳过 1 回合',
  handsaw: '下次射击伤害翻倍（2 命）',
  beer: '退出当前膛内的 1 发弹',
  adrenaline: '偷对手一件道具并立即使用',
  inverter: '切换当前弹（实↔空）',
  phone: '提示某一发是实弹还是空弹',
};
