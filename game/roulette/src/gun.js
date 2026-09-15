/* 恶魔轮盘 · 泵动式霰弹枪（程序化精细建模）
 * 结构（12 号口径泵动霰弹枪）：
 *   - 枪管（金属，带前端准星）
 *   - 管式弹仓（枪管下方，金属）
 *   - 机匣（金属主体，带抛壳口）
 *   - 泵动护木（木质，可前后滑动）
 *   - 枪托 + 握把（木质）
 *   - 扳机 + 扳机护圈（金属）
 * 朝向：枪口朝 -z（正对恶魔），枪托朝 +z（玩家侧）
 * 提供方法：pump()（泵动动画）、flash()（枪口火光）、aimAt('me'|'foe')
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

  // 枪管前端准星（小方块）
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.012), metalDark);
  sight.position.set(0, 0.03, -0.5);
  gun.add(sight);

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

  // ---- 机匣（金属主体） ----
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.2), metal);
  receiver.position.set(0, 0, 0.02);
  gun.add(receiver);

  // 抛壳口（机匣右侧凹槽：深色小盒）
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.07), metalDark);
  port.position.set(0.04, 0.012, 0.06);
  gun.add(port);

  // 机匣顶部导轨
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.14), metalDark);
  rail.position.set(0, 0.042, 0.0);
  gun.add(rail);

  // ---- 泵动护木（木质，套在弹仓外，可滑动） ----
  const pump = new THREE.Group();
  const pumpBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.16), wood);
  pumpBody.position.set(0, -0.035, 0);
  pump.add(pumpBody);
  // 护木防滑纹（几道细线）
  for (let i = 0; i < 5; i++) {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.006, 0.008), MAT.woodDark);
    grip.position.set(0, -0.035, -0.06 + i * 0.03);
    pump.add(grip);
  }
  pump.position.set(0, 0, -0.2);
  gun.add(pump);

  // ---- 枪托（木质，斜向下后） ----
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.26), wood);
  stock.position.set(0, -0.03, 0.24);
  stock.rotation.x = -0.10;
  gun.add(stock);

  // 枪托底板（金属）
  const buttPlate = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.115, 0.014), metalDark);
  buttPlate.position.set(0, -0.035, 0.37);
  buttPlate.rotation.x = -0.10;
  gun.add(buttPlate);

  // ---- 握把（木质，机匣下方后方，倾斜） ----
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.115, 0.055), wood);
  grip.position.set(0, -0.075, 0.11);
  grip.rotation.x = 0.32;
  gun.add(grip);

  // ---- 扳机 + 护圈 ----
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.032, 0.008), metalDark);
  trigger.position.set(0, -0.055, 0.05);
  gun.add(trigger);

  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 8, 16, Math.PI), metal);
  guard.rotation.x = Math.PI / 2;
  guard.rotation.z = Math.PI;
  guard.position.set(0, -0.055, 0.062);
  gun.add(guard);

  // ---- 枪口火光（默认隐藏，开枪时显示） ----
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.95 })
  );
  flash.position.set(0, 0, -0.54);
  flash.visible = false;
  gun.add(flash);

  // 枪口点光源（开枪瞬间照亮）
  const flashLight = new THREE.PointLight(0xffc070, 0, 3, 2);
  flashLight.position.set(0, 0, -0.54);
  gun.add(flashLight);

  // ---- 状态与动画 ----
  let pumpT = 0;      // 泵动动画进度 0..1
  let flashT = 0;     // 火光计时
  let pumping = false;
  let aiming = 'foe'; // 当前枪口朝向：'foe'（对手）| 'me'（自己）

  gun.userData = {
    /** 泵动上膛（把下一发送入膛内） */
    pump() {
      if (pumping) return;
      pumping = true;
      pumpT = 0;
    },
    /** 开枪：枪口火光 + 后坐 */
    fire() {
      flashT = 0.09;
      flash.visible = true;
      flashLight.intensity = 6;
      // 后坐：枪身后移并上抬（由 update 复原）
      gun.position.z += 0.05;
      gun.rotation.x -= 0.09;
    },
    /** 瞄准：'me'（自射，枪口转向自己）| 'foe'（射对手） */
    aim(target) { aiming = target; },
    getAim() { return aiming; },
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
      // 火光衰减
      if (flashT > 0) {
        flashT -= dt;
        flash.scale.setScalar(1 + (0.09 - flashT) * 6);
        flashLight.intensity = Math.max(0, flashT / 0.09) * 6;
        if (flashT <= 0) { flash.visible = false; flashLight.intensity = 0; flash.scale.setScalar(1); }
      }
      // 后坐复位（弹回原位）
      gun.position.z += (0 - gun.position.z) * Math.min(1, dt * 8);
      gun.rotation.x += (0 - gun.rotation.x) * Math.min(1, dt * 8);
      // 瞄准姿态：射自己时枪口转向玩家（枪身旋转 ~180° 的视觉效果：绕 y 转并抬高
      const targetRotY = aiming === 'me' ? Math.PI * 0.86 : 0;
      const targetRotX = aiming === 'me' ? -0.5 : 0;
      gun.rotation.y += (targetRotY - gun.rotation.y) * Math.min(1, dt * 6);
      // 轻微待机晃动（手持感）
      gun.rotation.z = Math.sin(tSec * 1.6) * 0.012;
    },
  };

  return gun;
}
