/* 恶魔轮盘 · 泵动式霰弹枪（程序化精细建模）
 * 结构（12 号口径泵动霰弹枪）：
 *   - 枪管（金属，带前端准星）
 *   - 管式弹仓（枪管下方，金属）
 *   - 机匣（金属主体，带抛壳口）
 *   - 泵动护木（木质，可前后滑动）
 *   - 枪托 + 握把（木质）
 *   - 扳机 + 扳机护圈（金属）
 * 朝向：枪口朝 -z（正对恶魔），枪托朝 +z（玩家侧）
 * 提供方法：pump()（泵动动画）、flash()（枪口火光）、aim('me'|'foe'|'idle')（目标方位）
 */
import * as THREE from '../lib/three.module.min.js';

export function createShotgun(MAT) {
  const gun = new THREE.Group();

  const metal = MAT.iron;
  const metalDark = MAT.ironDark;
  const wood = MAT.wood;

  // ---- 枪管（长 0.52，半径 0.022） ----
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.52, 16),
    metal
  );
  barrel.rotation.x = Math.PI / 2;          // 沿 z 轴
  barrel.position.set(0, 0, -0.26);
  gun.add(barrel);

  // 枪管散热肋环（3 道，泵动霰弹枪特征）
  for (const rz of [-0.34, -0.27, -0.2]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.0235, 0.004, 8, 20), metalDark);
    rib.rotation.x = Math.PI / 2;
    rib.position.set(0, 0, rz);
    gun.add(rib);
  }
  // 枪口收束器（喇叭口，前端加粗段）
  const choke = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.023, 0.03, 18), metalDark);
  choke.rotation.x = Math.PI / 2;
  choke.position.set(0, 0, -0.525);
  gun.add(choke);
  // 枪管前端准星（小方块 + 金属珠）
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.012), metalDark);
  sight.position.set(0, 0.03, -0.5);
  gun.add(sight);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8b45a, metalness: 0.9, roughness: 0.3 }));
  bead.position.set(0, 0.04, -0.53);
  gun.add(bead);

  // ---- 管式弹仓（枪管下方，稍短） ----
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.42, 14),
    metal
  );
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -0.035, -0.22);
  gun.add(tube);

  // 弹仓前端帽
  const tubeCap = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.03, 14), metalDark);
  tubeCap.rotation.x = Math.PI / 2;
  tubeCap.position.set(0, -0.035, -0.43);
  gun.add(tubeCap);
  // 弹仓环箍（两道）
  for (const tz of [-0.31, -0.13]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0195, 0.0028, 8, 16), metalDark);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, -0.035, tz);
    gun.add(band);
  }

  // ---- 机匣（金属主体） ----
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.2), metal);
  receiver.position.set(0, 0, 0.02);
  gun.add(receiver);

  // 抛壳口（机匣右侧凹槽：深色小盒）
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.07), metalDark);
  port.position.set(0.04, 0.012, 0.06);
  gun.add(port);

  // 机匣顶部导轨（带锯齿）
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.14), metalDark);
  rail.position.set(0, 0.042, 0.0);
  gun.add(rail);
  for (let i = 0; i < 5; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.01), metalDark);
    tooth.position.set(0, 0.05, -0.05 + i * 0.025);
    gun.add(tooth);
  }
  // 机匣铆钉（4 颗）
  for (const [rx, rz] of [[-0.028, 0.1], [0.028, 0.1], [-0.028, -0.06], [0.028, -0.06]]) {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xc8ced8, metalness: 0.85, roughness: 0.3 }));
    rivet.position.set(rx, 0.038, rz);
    gun.add(rivet);
  }

  // ---- 泵动护木（木质，套在弹仓外，可滑动） ----
  const pump = new THREE.Group();
  const pumpBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.16), wood);
  pumpBody.position.set(0, -0.035, 0);
  pump.add(pumpBody);
  // 护木防滑纹（几道细线）
  for (let i = 0; i < 8; i++) {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.006, 0.008), MAT.woodDark);
    grip.position.set(0, -0.035, -0.07 + i * 0.02);
    pump.add(grip);
  }
  pump.position.set(0, 0, -0.2);
  gun.add(pump);

  // ---- 枪托（木质，斜向下后） ----
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.26), wood);
  stock.position.set(0, -0.03, 0.24);
  stock.rotation.x = -0.10;
  gun.add(stock);

  // 枪托底板（金属 + 缓冲垫纹）
  const buttPlate = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.115, 0.014), metalDark);
  buttPlate.position.set(0, -0.035, 0.37);
  buttPlate.rotation.x = -0.10;
  gun.add(buttPlate);
  for (let i = 0; i < 3; i++) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.008, 0.002),
      new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.9 }));
    pad.position.set(0, -0.02 - i * 0.03, 0.377);
    pad.rotation.x = -0.10;
    gun.add(pad);
  }

  // ---- 握把（木质，机匣下方后方，倾斜） ----
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.115, 0.055), wood);
  grip.position.set(0, -0.075, 0.11);
  grip.rotation.x = 0.32;
  gun.add(grip);

  // ---- 扳机 + 护圈 ----
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.032, 0.008), metalDark);
  trigger.position.set(0, -0.055, 0.05);
  gun.add(trigger);

  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 8, 20), metal);
  guard.rotation.x = Math.PI / 2;
  guard.rotation.z = Math.PI;
  guard.position.set(0, -0.055, 0.062);
  gun.add(guard);
  // 扳机护圈横档
  const guardBar = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.007, 0.007), metalDark);
  guardBar.position.set(0, -0.083, 0.062);
  gun.add(guardBar);

  // ---- 枪口火光（双层 + 光晕，开枪时显示） ----
  const flashCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 1 })
  );
  flashCore.position.set(0, 0, -0.56);
  flashCore.visible = false;
  gun.add(flashCore);
  const flashHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff9030, transparent: true, opacity: 0.75 })
  );
  flashHalo.position.set(0, 0, -0.56);
  flashHalo.visible = false;
  gun.add(flashHalo);
  // 枪口光晕精灵（星形放射感）
  const glowTex = document.createElement('canvas'); glowTex.width = glowTex.height = 64;
  const gc = glowTex.getContext('2d');
  const grad = gc.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,190,1)');
  grad.addColorStop(0.35, 'rgba(255,170,80,0.8)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  gc.fillStyle = grad; gc.fillRect(0, 0, 64, 64);
  const flashGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowTex), transparent: true, opacity: 0.9, depthWrite: false })
  );
  flashGlow.scale.set(0.5, 0.5, 1);
  flashGlow.position.set(0, 0.01, -0.58);
  flashGlow.visible = false;
  gun.add(flashGlow);

  // 枪口点光源（开枪瞬间照亮）
  const flashLight = new THREE.PointLight(0xffc070, 0, 3, 2);
  flashLight.position.set(0, 0, -0.54);
  gun.add(flashLight);

  // ---- 状态与动画 ----
  let pumpT = 0;      // 泵动动画进度 0..1
  let flashT = 0;     // 火光计时
  let pumping = false;
  // 目标方位（与持枪者无关）：'me'=对准玩家(+z,π) | 'foe'=对准恶魔(-z,0) | 'idle'=45°斜放
  let aiming = 'idle';
  let raiseT = 1;     // 举枪进度 0..1（每次瞄准重新从 0 升起 → 首次开枪也会举起）
  let recoilT = 0;    // 后坐 0..1
  let layT = 1;       // 拿/放进度：1=45°躺桌　0=端平举起（拿起/放下动画核心）
  let gateRot = 0;    // 转向门：端起完成后才从 0→1（拿起→瞄准 两段式）

  gun.userData = {
    liftY: 0,           // 端起抬升量（玩家射击时枪离桌升起，main 叠加到 position.y）
    /** 泵动上膛（把下一发送入膛内） */
    pump() {
      if (pumping) return;
      pumping = true;
      pumpT = 0;
    },
    /** 开枪：枪口火光 + 后坐 */
    fire() {
      flashT = 0.1;
      flashCore.visible = true;
      flashHalo.visible = true;
      flashGlow.visible = true;
      flashLight.intensity = 9;
      recoilT = 1;            // 后坐（由 update 衰减）
    },
    /** 瞄准：aim('me') = 对准玩家(+z)｜aim('foe') = 对准恶魔(-z)｜aim('idle') = 45° 斜放待机
     *  每次瞄准都重新举枪（raiseT 从 0 升起），保证每次开枪都有抬起动作 */
    aim(dir) {
      aiming = (dir === 'me') ? 'me' : (dir === 'foe' ? 'foe' : 'idle');
      if (aiming === 'idle') {
        layT = 1;                  // 放下：慢慢躺回 45°
      } else {
        layT = 0;                  // 拿起来：端平 + 举起
        raiseT = 0;
      }
    },
    /** 每帧更新（t = 帧间隔秒） */
    update(dt, tSec) {
      // 泵动动画：护木后拉再复位（0.42s）
      if (pumping) {
        pumpT += dt / 0.42;
        if (pumpT >= 1) { pumpT = 1; pumping = false; }
        // 曲线：0→0.5 后拉，0.5→1 复位
        const k = pumpT < 0.5 ? pumpT / 0.5 : (1 - pumpT) / 0.5;
        pump.position.z = -0.2 + k * 0.07;
      }
      // 火光衰减（核心先缩，光环外扩，光晕淡出）
      if (flashT > 0) {
        flashT -= dt;
        const fk = Math.max(0, flashT / 0.1);
        flashCore.scale.setScalar(1 + (0.1 - flashT) * 3);
        flashHalo.scale.setScalar(1 + (0.1 - flashT) * 8);
        flashHalo.material.opacity = 0.75 * fk;
        flashGlow.material.opacity = 0.9 * fk;
        flashLight.intensity = fk * 9;
        if (flashT <= 0) {
          flashCore.visible = flashHalo.visible = flashGlow.visible = false;
          flashLight.intensity = 0;
          flashCore.scale.setScalar(1); flashHalo.scale.setScalar(1); flashHalo.material.opacity = 0.75; flashGlow.material.opacity = 0.9;
        }
      }
      // 后坐衰减复位
      recoilT = Math.max(0, recoilT - dt * 3.6);
      gun.position.z += (0 - gun.position.z) * Math.min(1, dt * 8);
      // ===== 拿起/放下（lay）+ 举枪（raiseT）+ 后坐（recoilT）一体化 =====
      const layTarget = (aiming === 'idle') ? 1 : 0;          // 放下→躺回 / 拿起→端平
      layT += (layTarget - layT) * Math.min(1, dt * 5.2);     // 拿起更快：~0.6s 端平到位
      const lay = layT * layT * (3 - 2 * layT);               // smoothstep 0..1

      // 举枪进度（拿起过程中同步抬起）
      if (aiming !== 'idle' && raiseT < 1) raiseT = Math.min(1, raiseT + dt / 0.38);
      const ra = raiseT * raiseT * (3 - 2 * raiseT);
      const overshoot = Math.sin(Math.min(1, raiseT * 1.4) * Math.PI) * 0.03;   // 轻微过头
      const aimPitch = -(ra * (aiming === 'me' ? 0.28 : 0.22)) + overshoot + recoilT * 0.13;

      // 两段式瞄准：① 先端起（45° 躺 → 端平朝前 0°）② 端起完成(≥75%)才旋转到目标方位
      const pickUp = 1 - lay;                                   // 端起程度 0..1
      const gateGoal = (aiming === 'idle') ? 0 : Math.max(0, Math.min(1, (pickUp - 0.72) / 0.28));
      gateRot += (gateGoal - gateRot) * Math.min(1, dt * 9);    // 平滑门
      const baseYaw = (aiming === 'me') ? Math.PI : (aiming === 'foe' ? 0 : -Math.PI / 4);
      // 端起时 yaw 归 0（端平朝前），端起完成后 gateRot→1 才转到目标方位
      const yawTarget = (-Math.PI / 4) * (1 - pickUp) + baseYaw * gateRot;
      gun.rotation.y += (yawTarget - gun.rotation.y) * Math.min(1, dt * 6.5);

      // 俯仰：躺平=微倾 0.02 ｜ 端平举起=瞄准俯仰（放下时平滑回平）
      const pitchTarget = lay * 0.02 + (1 - lay) * (aiming === 'idle' ? 0 : aimPitch);
      gun.rotation.x += (pitchTarget - gun.rotation.x) * Math.min(1, dt * 6);
      // 端起抬升：枪从桌面明显离桌升起（由 main 在 lerp 后叠加）
      const liftTarget = (aiming === 'idle') ? 0 : (1 - lay) * 0.035;   // 端起微抬（别太高）
      gun.userData.liftY += (liftTarget - gun.userData.liftY) * Math.min(1, dt * 6);

      // 侧倾：躺下加重侧躺；端平时轻微手持晃动
      const rollTarget = lay * 0.055 + (1 - lay) * (aiming === 'idle' ? 0 : Math.sin(tSec * 1.6) * 0.012);
      gun.rotation.z += (rollTarget - gun.rotation.z) * Math.min(1, dt * 6);
    },
  };

  return gun;
}
