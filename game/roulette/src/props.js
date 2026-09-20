/* 恶魔轮盘 · 子弹 + 8 种道具（程序化精细建模）
 *   - createShell(isLive)：红色实弹 / 蓝色空弹（12 号霰弹：黄铜弹壳 + 弹头）
 *   - createItem(type)：8 种道具（放大镜/香烟/手铐/手锯/啤酒/肾上腺素/感应调整器/手机）
 * 所有道具带 userData.update(dt, t)：悬浮 + 缓慢自转（放在桌上道具格或手边）
 */
import * as THREE from '../lib/three.module.min.js?v=r7';

/* ---------- 子弹 ---------- */
export function createShell(isLive) {
  const g = new THREE.Group();
  // 黄铜弹壳（金属 · 带竖向高光层次）
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.32, metalness: 0.88 });
  const shellCase = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.0115, 0.038, 20), caseMat);
  g.add(shellCase);
  // 弹壳底部抽壳槽（细环，增加真实感）
  const groove = new THREE.Mesh(new THREE.TorusGeometry(0.0114, 0.0011, 6, 20),
    new THREE.MeshStandardMaterial({ color: 0x8a6f2c, roughness: 0.45, metalness: 0.85 }));
  groove.rotation.x = Math.PI / 2;
  groove.position.y = -0.013;
  g.add(groove);
  // 弹壳底座（金属环）
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.006, 20),
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
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.011, 0.016, 20), tipMat);
  tip.position.y = 0.026;
  g.add(tip);
  // 弹头滚花环（两圈细环）
  for (const ty of [0.021, 0.031]) {
    const knurl = new THREE.Mesh(new THREE.TorusGeometry(0.0106, 0.0007, 5, 18), tipMat);
    knurl.rotation.x = Math.PI / 2;
    knurl.position.y = ty;
    g.add(knurl);
  }
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
      // 镜框内圈（双层金属环，细化质感）
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.0235, 0.0022, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0xa8862a, roughness: 0.4, metalness: 0.9 }));
      g.add(ring2);
      // 镜框螺纹（一圈细密凸点）
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 5, 4), M(0xd8b444, 0.3, 0.95));
        stud.position.set(Math.cos(a) * 0.0335, Math.sin(a) * 0.0335, 0);
        g.add(stud);
      }
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.055, 12), M(0x5a3a1c, 0.6, 0.05));
      handle.position.y = -0.055;
      g.add(handle);
      // 手柄缠绳纹（4 圈）
      for (let i = 0; i < 4; i++) {
        const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.0068, 0.0011, 5, 12), M(0x2e1d0e, 0.85, 0.02));
        wrap.rotation.x = Math.PI / 2;
        wrap.position.y = -0.045 - i * 0.011;
        g.add(wrap);
      }
      // 镜片反光（小亮片增强玻璃感）
      const glint = new THREE.Mesh(new THREE.CircleGeometry(0.008, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      glint.position.set(-0.009, 0.01, 0.0035);
      glint.rotation.z = 0.6;
      g.add(glint);
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
      // 滤嘴环纹（两圈压痕）
      for (const fy of [-0.036, -0.046]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.0058, 0.0006, 5, 12), M(0xb5762c, 0.85, 0));
        band.rotation.x = Math.PI / 2;
        band.position.y = fy;
        g.add(band);
      }
      const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.0053, 0.0053, 0.008, 12), M(0x3a3330, 0.95, 0));
      ash.position.y = 0.034;
      g.add(ash);
      // 烟灰裂纹（两小片暗色）
      for (const [ax, az] of [[0.002, 0.0035], [-0.0022, -0.0028]]) {
        const crack = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.003, 0.0006), M(0x1f1b18, 1, 0));
        crack.position.set(ax, 0.036, az);
        g.add(crack);
      }
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
      // 中间链（4 节小环，更细腻）
      for (let i = 0; i < 4; i++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.0048, 0.0015, 6, 12), mat);
        link.rotation.x = Math.PI / 2;
        link.rotation.z = (i % 2) * Math.PI / 2;
        link.position.set(-0.0105 + i * 0.007, 0, 0);
        g.add(link);
      }
      // 锁扣机构（每环外侧的小方块 + 齿条）
      for (const dx of [-0.022, 0.022]) {
        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.008, 0.008), M(0x8e96a2, 0.3, 0.9));
        lock.position.set(dx, 0.017, 0);
        g.add(lock);
        for (let t = 0; t < 3; t++) {
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.0016, 0.006), M(0xc8d0da, 0.25, 0.95));
          tooth.position.set(dx - 0.004 + t * 0.004, 0.021, 0);
          g.add(tooth);
        }
        // 钥匙孔（小凹点）
        const keyhole = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.002, 8), M(0x14181e, 0.9, 0.3));
        keyhole.rotation.x = Math.PI / 2;
        keyhole.position.set(dx, -0.016, 0.001);
        g.add(keyhole);
      }
      // 环上铆钉（每环 4 颗）
      for (const dx of [-0.022, 0.022]) {
        for (let r = 0; r < 4; r++) {
          const a = Math.PI / 4 + r * Math.PI / 2;
          const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 5, 4), M(0xe8eef6, 0.2, 0.95));
          rivet.position.set(dx + Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0);
          g.add(rivet);
        }
      }
      break;
    }
    /* 手锯：锯齿金属片 + 木柄 */
    case 'handsaw': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.026, 0.002),
        new THREE.MeshStandardMaterial({ color: 0xc4c9d2, roughness: 0.2, metalness: 0.95 }));
      g.add(blade);
      // 锯齿（下缘一排小三角 · 加密到 13 齿）
      for (let i = 0; i < 13; i++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.0028, 0.0055, 4),
          new THREE.MeshStandardMaterial({ color: 0xd6dbe4, roughness: 0.18, metalness: 0.96 }));
        tooth.rotation.z = Math.PI;
        tooth.position.set(-0.036 + i * 0.006, -0.015, 0);
        g.add(tooth);
      }
      // 锯背加厚条 + 铆钉
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.006, 0.0035),
        new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.25, metalness: 0.95 }));
      spine.position.set(0, 0.015, 0);
      g.add(spine);
      for (let i = 0; i < 3; i++) {
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 5),
          new THREE.MeshStandardMaterial({ color: 0xdfe4ec, roughness: 0.2, metalness: 0.95 }));
        rivet.position.set(-0.02 + i * 0.02, 0.006, 0.0018);
        g.add(rivet);
      }
      // 木柄（加指槽）
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.024, 0.012), M(0x6b3f1e, 0.65, 0.05));
      handle.position.set(0.052, -0.002, 0);
      g.add(handle);
      for (let i = 0; i < 3; i++) {
        const grip = new THREE.Mesh(new THREE.TorusGeometry(0.0115, 0.0012, 5, 12), M(0x4a2a12, 0.8, 0.03));
        grip.rotation.y = Math.PI / 2;
        grip.position.set(0.043 + i * 0.009, -0.002, 0);
        g.add(grip);
      }
      // 柄尾金属箍
      const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.004, 10),
        new THREE.MeshStandardMaterial({ color: 0xa8aeb8, roughness: 0.3, metalness: 0.9 }));
      ferrule.rotation.z = Math.PI / 2;
      ferrule.position.set(0.036, -0.002, 0);
      g.add(ferrule);
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
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.017, 0.004, 20),
        new THREE.MeshStandardMaterial({ color: 0xa8adb6, roughness: 0.25, metalness: 0.95 }));
      top.position.y = 0.03;
      g.add(top);
      // 罐体上下凹槽环（易拉罐特征）
      for (const cy of [0.024, -0.024]) {
        const neck = new THREE.Mesh(new THREE.TorusGeometry(0.0168, 0.0012, 6, 20), M(0xcfd4dc, 0.3, 0.9));
        neck.rotation.x = Math.PI / 2;
        neck.position.y = cy;
        g.add(neck);
      }
      // 拉环（外环 + 拉片）
      const tab = new THREE.Mesh(new THREE.TorusGeometry(0.005, 0.0012, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0xc0c6cf, roughness: 0.3, metalness: 0.9 }));
      tab.rotation.x = Math.PI / 2;
      tab.position.set(0, 0.033, 0);
      g.add(tab);
      const pull = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.0008, 0.0035),
        new THREE.MeshStandardMaterial({ color: 0xd6dbe3, roughness: 0.35, metalness: 0.85 }));
      pull.position.set(0.004, 0.033, 0);
      g.add(pull);
      // 标签上的小图案（深色方块组成 logo 感）
      for (let i = 0; i < 3; i++) {
        const mark = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.007, 0.0012), M(0x1c2a1f, 0.7, 0.2));
        mark.position.set(-0.008 + i * 0.008, -0.002, 0.0172);
        g.add(mark);
      }
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
      // 活塞推杆（细杆 + 顶帽）
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.022, 8), M(0xd0d5dd, 0.35, 0.7));
      rod.position.y = 0.036;
      g.add(rod);
      const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.0035, 12), M(0xe4e9f0, 0.4, 0.5));
      capTop.position.y = 0.048;
      g.add(capTop);
      // 刻度线（针管上的 5 道细环）
      for (let i = 0; i < 5; i++) {
        const tick = new THREE.Mesh(new THREE.TorusGeometry(0.0078, 0.0004, 4, 12), M(0x8fa8bf, 0.5, 0.2));
        tick.rotation.x = Math.PI / 2;
        tick.position.y = -0.016 + i * 0.008;
        g.add(tick);
      }
      // 液体中的小气泡
      for (const [bx, by] of [[0.0022, -0.004], [-0.0018, 0.004], [0.001, -0.012]]) {
        const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.0008, 5, 4),
          new THREE.MeshBasicMaterial({ color: 0xffc2cc, transparent: true, opacity: 0.8 }));
        bubble.position.set(bx, by, 0);
        g.add(bubble);
      }
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
      // 金属铭牌（正面小牌）
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.001), M(0xc8cdd6, 0.35, 0.85));
      plate.position.set(-0.01, -0.008, 0.0125);
      g.add(plate);
      // 接线柱（两个铜柱）
      for (const px of [0.006, 0.016]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.006, 8), M(0xc98a3a, 0.4, 0.85));
        post.rotation.x = Math.PI / 2;
        post.position.set(px, -0.008, 0.014);
        g.add(post);
      }
      // 旋钮滚花（8 条细齿）
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0012, 0.006), M(0xd0d6de, 0.3, 0.9));
        tooth.position.set(-0.012 + Math.cos(a) * 0.0082, Math.sin(a) * 0.0082, 0.016);
        g.add(tooth);
      }
      // 四角螺丝
      for (const [sx, sz] of [[-0.018, 0.014], [0.018, 0.014], [-0.018, -0.014], [0.018, -0.014]]) {
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.0012, 6), M(0x9aa2ae, 0.35, 0.9));
        screw.rotation.x = Math.PI / 2;
        screw.position.set(sx, 0.014, sz);
        g.add(screw);
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
      // 听筒（顶部三孔）
      for (let i = 0; i < 3; i++) {
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.0015, 6), M(0x11151b, 0.9, 0.2));
        hole.rotation.x = Math.PI / 2;
        hole.position.set(-0.005 + i * 0.005, 0.024, 0.0045);
        g.add(hole);
      }
      // 屏幕上的小图标（通话/信号 两块发光片）
      const icon1 = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.003, 0.0008),
        new THREE.MeshStandardMaterial({ color: 0xd8fff0, emissive: 0x66ffcc, emissiveIntensity: 0.9 }));
      icon1.position.set(-0.006, 0.012, 0.0062);
      g.add(icon1);
      const icon2 = icon1.clone();
      icon2.position.set(0.005, -0.012, 0.0062);
      icon2.scale.setScalar(0.8);
      g.add(icon2);
      // 侧边金属中框
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.0315, 0.05, 0.004), M(0x5a616c, 0.35, 0.75));
      frame.position.z = 0.002;
      g.add(frame);
      break;
    }
    default: {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), M(0x888888, 0.6, 0.2));
      g.add(cube);
      break;
    }
  }

  // 道具通用动画：悬浮 + 自转
  // ⚠ 悬浮基准 baseY 必须「首次 update 时」从当前位置读取——
  // 因为道具是先 createItem()（y=0）再被摆放到格子上（set position），
  // 若创建时捕获会覆盖摆放高度导致道具沉到桌面以下。
  g.userData.type = type;
  g.userData.update = function (dt, t) {
    if (g.userData.baseY == null) g.userData.baseY = g.position.y;
    g.rotation.y += dt * 0.8;
    g.position.y = g.userData.baseY + Math.sin(t * 2 + g.userData.baseY * 12) * 0.006;
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
