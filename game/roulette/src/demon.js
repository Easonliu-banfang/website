/* 恶魔轮盘 · 恶魔（庄家 Dealer）角色建模
 * 原版造型：只有一个巨大的头 + 两只漂浮的手（无身体）——诡异、压迫感
 * 建模：
 *   - 巨大头颅（球体，略扁，苍白肤色）
 *   - 两只角（圆锥，暗色）
 *   - 深陷眼窝 + 发光红瞳
 *   - 狰狞咧嘴（暗色口腔 + 参差白牙）
 *   - 两只漂浮手（苍白，手指简模），悬浮在头两侧下方
 * 动画：整体上下浮动 + 轻微左右摇摆；手部各自漂浮；说话/受击时可调用 react()
 */
import * as THREE from '../lib/three.module.min.js';

export function createDemon() {
  const demon = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2c4, roughness: 0.72, metalness: 0.02,
    emissive: 0x2a2620, emissiveIntensity: 0.25,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 0.9 });
  const hornMat = new THREE.MeshStandardMaterial({ color: 0x3b3128, roughness: 0.65 });

  // ---- 头颅（大球，略扁） ----
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), skinMat);
  head.scale.set(1, 0.92, 0.95);
  demon.add(head);

  // 眉骨（突出，压迫感）
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.1), skinMat);
  brow.position.set(0, 0.1, 0.28);
  brow.rotation.x = 0.16;
  demon.add(brow);
  // 额头皱纹（3 道浅沟）
  for (let i = 0; i < 3; i++) {
    const wrinkle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.012),
      new THREE.MeshStandardMaterial({ color: 0xb8b1a0, roughness: 0.95 }));
    wrinkle.position.set(0, 0.17 + i * 0.045, 0.285);
    demon.add(wrinkle);
  }
  // 颧骨疤痕（右颊一道深色斜纹）
  const scar = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.01, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x7a6f5c, roughness: 0.85 }));
  scar.position.set(0.16, -0.05, 0.28);
  scar.rotation.z = -0.35;
  demon.add(scar);

  // ---- 双角 ----
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 12), hornMat);
    horn.position.set(sx * 0.19, 0.29, -0.02);
    horn.rotation.z = sx * 0.42;
    horn.rotation.x = -0.16;
    demon.add(horn);
    // 角根（略粗）
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.04, 12), hornMat);
    base.position.set(sx * 0.17, 0.2, -0.01);
    demon.add(base);
    // 角环纹（3 道，螺旋起伏感）
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042 - i * 0.008, 0.006, 6, 14), hornMat);
      ring.position.set(sx * 0.17, 0.235 + i * 0.05, -0.01);
      ring.rotation.y = sx * 0.3;
      ring.rotation.z = Math.PI / 2 + sx * 0.25;
      demon.add(ring);
    }
  }

  // ---- 眼窝（深陷） + 发光红瞳 ----
  for (const sx of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), darkMat);
    socket.position.set(sx * 0.13, 0.05, 0.27);
    socket.scale.set(1, 0.85, 0.6);
    demon.add(socket);
    // 红瞳（发光）
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0xff3020, emissive: 0xff1a08, emissiveIntensity: 2.1, roughness: 0.3,
      })
    );
    pupil.position.set(sx * 0.13, 0.045, 0.32);
    demon.add(pupil);
    // 竖缝瞳孔（黑色细梭形，野兽感）
    const slit = new THREE.Mesh(
      new THREE.SphereGeometry(0.013, 10, 8, 0, Math.PI * 2, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1, metalness: 0.1 })
    );
    slit.scale.set(0.55, 1.35, 0.5);
    slit.position.set(sx * 0.13, 0.045, 0.347);
    demon.add(slit);
    // 瞳孔高光（小白点）
    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 })
    );
    glint.position.set(sx * 0.13 + 0.012, 0.058, 0.345);
    demon.add(glint);
  }

  // ---- 狰狞咧嘴（口腔 + 牙） ----
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), darkMat);
  mouth.rotation.x = Math.PI * 0.62;
  mouth.position.set(0, -0.13, 0.24);
  mouth.scale.set(1, 0.72, 0.5);
  demon.add(mouth);
  // 上排牙 + 下排牙（参差小白块）
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.5 });
  for (let i = 0; i < 9; i++) {
    // 上牙（中间两颗拉长为犬齿）
    const isFang = (i === 3 || i === 5);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, isFang ? 0.05 : 0.028, 0.018), toothMat);
    t.position.set(-0.08 + i * 0.02, -0.1 + (isFang ? 0.012 : 0), 0.3);
    if (isFang) t.rotation.z = i === 3 ? -0.12 : 0.12;
    demon.add(t);
    // 下牙
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.024, 0.016), toothMat);
    b.position.set(-0.07 + i * 0.019, -0.175, 0.295);
    demon.add(b);
  }
  // 犬齿尖（上牙两侧的尖锥）
  for (const fx of [-0.062, 0.062]) {
    const fangTip = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, 8), toothMat);
    fangTip.position.set(fx, -0.065, 0.315);
    fangTip.rotation.z = fx < 0 ? -0.25 : 0.25;
    demon.add(fangTip);
  }

  // ---- 两只漂浮手 ----
  const hands = [];
  for (const sx of [-1, 1]) {
    const hand = new THREE.Group();
    // 手掌（扁椭球）
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), skinMat);
    palm.scale.set(1, 0.62, 0.78);
    hand.add(palm);
    // 四指（小圆柱）
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.075, 8), skinMat);
      f.rotation.z = Math.PI / 2;
      f.position.set(0.085, 0.028 - i * 0.026, -0.03);
      hand.add(f);
      // 指节（中段小环）
      const knuckle = new THREE.Mesh(new THREE.TorusGeometry(0.0108, 0.0022, 6, 10),
        new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.8 }));
      knuckle.rotation.y = Math.PI / 2;
      knuckle.position.set(0.11, 0.028 - i * 0.026, -0.03);
      hand.add(knuckle);
      // 指尖（略粗末端）
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), skinMat);
      tip.position.set(0.13, 0.028 - i * 0.026, -0.03);
      hand.add(tip);
    }
    // 拇指
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.055, 8), skinMat);
    thumb.rotation.z = Math.PI / 2;
    thumb.rotation.y = 0.7;
    thumb.position.set(0.01, -0.03, 0.055);
    hand.add(thumb);
    hand.position.set(sx * 0.42, -0.12, 0.12);
    // 镜向（左手翻转）
    if (sx < 0) hand.rotation.y = Math.PI;
    demon.add(hand);
    hands.push(hand);
  }

  // ---- 头部轮廓光（恶魔侧红光，增强压迫感） ----
  const rimLight = new THREE.PointLight(0xff5a3c, 0.9, 2.4, 2);
  rimLight.position.set(0, 0.1, 0.5);
  demon.add(rimLight);

  // ---- 状态 ----
  let hitT = 0;      // 受击闪烁计时
  let shakeT = 0;    // 说话/动作抖动

  demon.userData = {
    /** 受击（中弹）反应：剧烈抖动 + 红瞳闪白 */
    hit() { hitT = 0.4; shakeT = 0.4; },
    /** 说话/动作（轻微抖动） */
    talk() { shakeT = 0.25; },
    /** 每帧更新 */
    update(dt, t) {
      // 整体漂浮（缓慢上下 + 左右微摆）
      demon.position.y = 1.42 + Math.sin(t * 0.85) * 0.045;
      demon.rotation.y = Math.sin(t * 0.4) * 0.06;
      demon.rotation.z = Math.sin(t * 0.55) * 0.02;
      // 手部各自漂浮（错相位）
      hands.forEach((h, i) => {
        h.position.y = -0.12 + Math.sin(t * 1.1 + i * 1.7) * 0.035;
        h.rotation.z = Math.sin(t * 0.9 + i * 2.1) * 0.08;
      });
      // 受击/说话抖动（k 归一化 0..1；受击 hitT 额外加力）
      if (hitT > 0) hitT -= dt;
      if (shakeT > 0) {
        shakeT -= dt;
        const k = Math.max(0, Math.min(1, shakeT / 0.4));   // 0..1 平滑衰减
        const power = (hitT > 0) ? 1.9 : 1.0;               // 受击更剧烈
        demon.position.x = Math.sin(t * 55) * 0.04 * k * power;
        demon.rotation.x = Math.sin(t * 65) * 0.06 * k * power;
        demon.rotation.z = Math.sin(t * 85) * 0.035 * k * power;   // 加 z 轴颤抖更真实
      } else {
        demon.position.x += (0 - demon.position.x) * Math.min(1, dt * 6);
        demon.rotation.x += (0 - demon.rotation.x) * Math.min(1, dt * 6);
        demon.rotation.z = Math.sin(t * 0.55) * 0.02;        // 恢复漂浮微摆
      }
      // 红瞳呼吸 + 受击闪白（hitT 期间爆亮）
      const hitBlink = (hitT > 0) ? 3.2 : 0;
      const pulse = 1.6 + Math.sin(t * 2.4) * 0.5 + hitBlink * (hitT > 0 ? 1 : 0);
      demon.children.forEach((c) => {
        if (c.material && c.material.emissive && c.material.color && c.material.color.getHex() === 0xff3020) {
          c.material.emissiveIntensity = pulse;
        }
      });
    },
  };

  return demon;
}
