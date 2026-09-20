/* 恶魔轮盘 · 3D 场景模块 v3 ——「坐姿第一人称 · 精细建模」
 *
 * 在 v2 布局基础上全面细化（对标原版工业俱乐部的质感）：
 *   - 木桌：圆角桌面 + 厚实方锥铸铁腿 + 桌面勒痕/木纹（法线扰动用 bump 代替）
 *   - 桌面分区：细白线四边框 + 中分界线 + 四角象限 + 名牌道具格（带棱）
 *   - 中央枪托座：金属底座 + 铆钉 + 凹槽 V 形 + 侧向弹位指示
 *   - 计数机（diegetic 记分牌）：分层底座 + 玻璃绿屏 + 金属斜撑 + 充能红灯槽 + 顶部小牌
 *   - 吊灯：多层灯罩 + 铆钉 + 灯泡
 *   - 墙壁：踢脚线 + 装饰横条 + 转角柱 + 通风栅
 *   - 地面：接缝线
 *
 * 所有几何用 Box/Cyl/Sphere 等组合出"精细感"，纯程序化（零外部资源）。
 */
import * as THREE from '../lib/three.module.min.js?v=r10';
import { woodGrain, ironPlate, felt, screenText, screenDual, concrete } from './textures.js?v=r10';

export function createScene(canvas) {
  // ---- 渲染器 ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 3.1;   // 提亮：暗黑不黑屏

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);
  scene.fog = new THREE.Fog(0x0a0a0f, 7, 22);

  // ---- 摄像机：坐姿第一人称 ----
  const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 40);
  camera.position.set(0, 1.32, 1.62);
  camera.lookAt(0, 0.62, 0);

  // 常用材质工厂
  // 程序化纹理（零外部资源）
  const woodMap = woodGrain();
  const ironMap = ironPlate();
  ironMap.repeat.set(2, 2); ironMap.needsUpdate = true;
  const concreteMap = concrete(); concreteMap.repeat.set(3, 3); concreteMap.needsUpdate = true;
  const floorMap = woodGrain(); floorMap.repeat.set(4, 3); floorMap.needsUpdate = true;
  const screenMap = screenText('3');

  const MAT = {
    felt: new THREE.MeshStandardMaterial({ color: 0x8a2240, roughness: 0.9, metalness: 0.0, emissive: 0x3d1020, emissiveIntensity: 0.6 }),

    wood: new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.55, metalness: 0.07, emissive: 0x3a2410, emissiveIntensity: 0.55 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.55, metalness: 0.05 }),
    woodEdge: new THREE.MeshStandardMaterial({ color: 0x5c3d26, roughness: 0.42, metalness: 0.08 }),
    iron: new THREE.MeshStandardMaterial({ map: ironMap, roughness: 0.42, metalness: 0.75 }),
    ironDark: new THREE.MeshStandardMaterial({ map: ironMap, roughness: 0.5, metalness: 0.6 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteMap, roughness: 0.95, metalness: 0.02, emissive: 0x1c1f2a, emissiveIntensity: 0.4 }),
    floor: new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.85, metalness: 0.05, emissive: 0x181b24, emissiveIntensity: 0.6 }),
    mark: new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.35, metalness: 0.05, emissive: 0xcfc9b8, emissiveIntensity: 0.2 }),
    neon: new THREE.MeshStandardMaterial({ color: 0xff3b5c, emissive: 0xff3b5c, emissiveIntensity: 1.6 }),
    lampShade: new THREE.MeshStandardMaterial({ color: 0x1a1d27, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide }),
    lampBulb: new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc98a, emissiveIntensity: 2.4 }),
    machineBody: new THREE.MeshStandardMaterial({ map: ironMap, roughness: 0.35, metalness: 0.65 }),
    machineScreen: new THREE.MeshStandardMaterial({ map: screenMap, emissive: 0x2f7a54, emissiveIntensity: 0.85, emissiveMap: screenMap }),   // 稳定绿，不刺眼
    chargeOn: new THREE.MeshStandardMaterial({ color: 0xffb0c0, emissive: 0xff5c78, emissiveIntensity: 2.0 }),
    chargeOff: new THREE.MeshStandardMaterial({ color: 0x3a2026, roughness: 0.6 }),
  };

  // ================= 灯光 =================
  scene.add(new THREE.AmbientLight(0x9aa1e8, 2.2));
  const mainLight = new THREE.PointLight(0xffd9a0, 7.5, 22, 1.3);
  mainLight.position.set(0, 2.8, 0);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(1024, 1024);
  scene.add(mainLight);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.55);
  rim.position.set(-3.2, 2.2, 1.6);
  scene.add(rim);
  // 桌面专属光：强化桌上物件（枪座/道具格/计数机）可见度
  const tableLight = new THREE.PointLight(0xffe0b0, 3.0, 6, 1.6);
  tableLight.position.set(0, 1.35, 0);
  scene.add(tableLight);
  const neon = new THREE.PointLight(0xff3b5c, 0.8, 6, 2);
  neon.position.set(1.5, 1.6, -2.8);
  scene.add(neon);

  const add = (mesh) => { scene.add(mesh); return mesh; };

  // ================= 房间 =================
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), MAT.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  add(floor);

  // 地面接缝线（横向切割条）
  for (let z = -4; z <= 4; z += 2) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(12, 0.005, 0.03), MAT.ironDark);
    seam.position.set(0, 0.004, z);
    add(seam);
  }

  // 墙（四面闭合，飞行视角任意旋转不穿帮）
  const wallGeo = new THREE.BoxGeometry(12, 3.4, 0.25);
  const backWall = new THREE.Mesh(wallGeo, MAT.concrete); backWall.position.set(0, 1.7, -4.5); add(backWall);
  const lWall = new THREE.Mesh(wallGeo, MAT.concrete); lWall.rotation.y = Math.PI / 2; lWall.position.set(-6, 1.7, 0); add(lWall);
  const rWall = new THREE.Mesh(wallGeo, MAT.concrete); rWall.rotation.y = Math.PI / 2; rWall.position.set(6, 1.7, 0); add(rWall);
  const fWall = new THREE.Mesh(wallGeo, MAT.concrete); fWall.position.set(0, 1.7, 4.5); add(fWall);
  // （前墙腰线/踢脚线并入下方统一循环，避免引用未声明材质）

  // 墙面装饰横条（工业风腰线）
  const railMat = new THREE.MeshStandardMaterial({ color: 0x464c66, roughness: 0.6, metalness: 0.3, emissive: 0x2a2f44, emissiveIntensity: 0.4 });
  for (const [x, z, ry] of [[0, -4.37, 0], [-5.87, 0, Math.PI / 2], [5.87, 0, Math.PI / 2], [0, 4.37, 0]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(12, 0.06, 0.06), railMat);
    rail.rotation.y = ry;
    rail.position.set(x, 1.15, z);
    add(rail);
    const rail2 = new THREE.Mesh(new THREE.BoxGeometry(12, 0.05, 0.05), railMat);
    rail2.rotation.y = ry;
    rail2.position.set(x, 2.1, z);
    add(rail2);
  }

  // 踢脚线
  const kickMat = new THREE.MeshStandardMaterial({ color: 0x12141c, roughness: 0.85 });
  for (const [x, z, ry] of [[0, -4.37, 0], [-5.87, 0, Math.PI / 2], [5.87, 0, Math.PI / 2], [0, 4.37, 0]]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(12, 0.16, 0.1), kickMat);
    k.rotation.y = ry;
    k.position.set(x, 0.08, z);
    add(k);
  }


  // 天花板 + 管线
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x171922, roughness: 1 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), ceilMat);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.4; add(ceil);
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x10131c, roughness: 0.7, metalness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 12, 8), pipeMat);
    pipe.rotation.z = Math.PI / 2; pipe.position.y = 3.32; pipe.position.z = -3 + i * 2;
    add(pipe);
  }

  // ================= 长桌（正方形布局 · 原版对照） =================
  // 原版：方形桌面；玩家近侧左右各 2 道具格；
  //       右侧立式记分牌(命数)；中线靠右子弹实虚指示器；
  //       中央圆形枪座；对面恶魔侧左右各 2 道具格。
  const TABLE_W = 1.6, TABLE_D = 1.6, TABLE_H = 0.75;   // 正方形桌
  const table = new THREE.Group();

  // 桌面（厚板 + 圆角分段）
  const tableTop = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_W, 0.06, TABLE_D, 10, 1, 10),
    MAT.wood
  );
  tableTop.position.y = TABLE_H - 0.03;
  tableTop.castShadow = tableTop.receiveShadow = true;
  table.add(tableTop);

  // 四边亮条
  function edgeBar(w, d, x, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), MAT.woodEdge);
    m.position.set(x, TABLE_H + 0.006, z);
    table.add(m);
  }
  edgeBar(TABLE_W, 0.02, 0, TABLE_D / 2 - 0.005);
  edgeBar(TABLE_W, 0.02, 0, -TABLE_D / 2 + 0.005);
  edgeBar(0.02, TABLE_D - 0.02, TABLE_W / 2 - 0.005, 0);
  edgeBar(0.02, TABLE_D - 0.02, -TABLE_W / 2 + 0.005, 0);

  // 四条方形铸造腿
  function tableLeg(x, z) {
    const g = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, TABLE_H - 0.06, 0.09), MAT.iron);
    leg.position.y = (TABLE_H - 0.06) / 2;
    leg.castShadow = true;
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.11), MAT.ironDark);
    foot.position.y = 0.015;
    g.add(foot);
    g.position.set(x, 0, z);
    table.add(g);
  }
  tableLeg(-TABLE_W / 2 + 0.16, -TABLE_D / 2 + 0.15);
  tableLeg(TABLE_W / 2 - 0.16, -TABLE_D / 2 + 0.15);
  tableLeg(-TABLE_W / 2 + 0.16, TABLE_D / 2 - 0.15);
  tableLeg(TABLE_W / 2 - 0.16, TABLE_D / 2 - 0.15);

  // ---- 中央圆形枪座（圆形毛毡垫 + 一圈金属环） ----
  const gunSeat = new THREE.Group();
  // 枪垫：圆形毛毡（红）
  const feltDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.26, 0.012, 32),
    MAT.felt
  );
  feltDisc.position.y = TABLE_H + 0.055;
  feltDisc.receiveShadow = true;
  gunSeat.add(feltDisc);
  // 金属外环（压边）
  const gunRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.016, 10, 36),
    MAT.iron
  );
  gunRing.rotation.x = Math.PI / 2;
  gunRing.position.y = TABLE_H + 0.06;
  gunSeat.add(gunRing);
  // 中心子弹就位小圆点（枪管方向指示）
  const tipDot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), MAT.iron);
  tipDot.position.set(0, TABLE_H + 0.062, 0.12);
  gunSeat.add(tipDot);
  // 枪座外圈铆钉（8 颗）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.85, roughness: 0.3 }));
    rivet.position.set(Math.cos(a) * 0.21, TABLE_H + 0.058, Math.sin(a) * 0.21);
    gunSeat.add(rivet);
  }
  // 枪座中心十字刻痕（两片细金属条）
  const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.004, 0.012), MAT.ironDark);
  crossA.position.set(0, TABLE_H + 0.058, 0);
  gunSeat.add(crossA);
  const crossB = crossA.clone();
  crossB.rotation.y = Math.PI / 2;
  crossB.scale.set(1, 1, 1.1);
  gunSeat.add(crossB);
  gunSeat.position.set(0, 0, 0);
  table.add(gunSeat);

  // ---- 中线（区分玩家/恶魔两侧；画在中央枪座两侧，不断开穿过桌面） ----
  const mk = (w, d, x, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.004, d), MAT.mark);
    m.position.set(x, TABLE_H + 0.033, z);
    if (ry) m.rotation.y = ry;
    table.add(m);
  };
  // 中线：左段 + 右段（右段让给子弹指示器）
  mk(0.018, TABLE_D - 0.1, -0.34, 0);
  mk(0.018, TABLE_D - 0.1, 0.12, 0);

  // （弹药计数器已移除：剩余实/空弹数由 HUD 文案 + 子弹导轨展示）


  // ---- 道具格：玩家侧左右各 2，恶魔侧左右各 2（共 8 格，方形分布） ----
  const SLOT_X = [0.30, 0.62];           // 每侧两格：内/外
  const SLOT_Z_ME = 0.52, SLOT_Z_FOE = -0.52;
  for (const side of [-1, 1]) {          // 左右
    for (let i = 0; i < 2; i++) {        // 玩家/恶魔两侧各 2 格（x 方向）
      const x = side * SLOT_X[i];
      // 玩家侧
      makeSlot(x, SLOT_Z_ME);
      // 恶魔侧
      makeSlot(x, SLOT_Z_FOE);
    }
  }
  function makeSlot(x, z) {
    // 白线格底
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.006, 0.24), MAT.mark);
    cell.position.set(x, TABLE_H + 0.036, z);
    table.add(cell);
    // 毛毡内格
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.012, 0.19), MAT.felt);
    inner.position.set(x, TABLE_H + 0.038, z);
    table.add(inner);
    // 四角点钉
    for (const cx of [-0.1, 0.1]) {
      for (const cz of [-0.1, 0.1]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), MAT.iron);
        dot.position.set(x + cx, TABLE_H + 0.045, z + cz);
        table.add(dot);
      }
    }
    // 格边棱线（四边细亮条，立体感）
    for (const [ex, ez, ew, ed] of [[0, -0.095, 0.21, 0.006], [0, 0.095, 0.21, 0.006], [-0.095, 0, 0.006, 0.21], [0.095, 0, 0.006, 0.21]]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(ew, 0.004, ed), MAT.mark);
      edge.position.set(x + ex, TABLE_H + 0.039, z + ez);
      table.add(edge);
    }
  }

  // ---- 桌面记分牌（单个 · 横版小台机立在桌面上 · 正面朝玩家：左=对手(红) 右=我(绿)） ----
  const scoreboard = new THREE.Group();
  // 机身：宽扁横牌（宽 0.42 > 高 0.24，立在桌面，比例正常）
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.05, 1, 4, 1),
    MAT.machineBody
  );
  body.position.y = 0.12;
  scoreboard.add(body);
  // 屏幕（正面 +z 朝向玩家）；左=对手命数(红)、右=我的命数(绿)
  const sbTex = screenDual(3, 3);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.16, 0.02),
    new THREE.MeshStandardMaterial({ map: sbTex, emissive: 0xffffff, emissiveMap: sbTex, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.1 })
  );
  screen.position.set(0, 0.12, 0.035);
  scoreboard.add(screen);
  // 屏幕金属边框（上下左右四根细边）
  const frameMat = MAT.iron;
  const frameT = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.022), frameMat);
  frameT.position.set(0, 0.2, 0.035);
  scoreboard.add(frameT);
  const frameB = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.022), frameMat);
  frameB.position.set(0, 0.04, 0.035);
  scoreboard.add(frameB);
  for (const sx of [-0.19, 0.19]) {
    const frameS = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.19, 0.022), frameMat);
    frameS.position.set(sx, 0.12, 0.035);
    scoreboard.add(frameS);
  }
  // 顶部小指示灯（工作状态）
  const sbLed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), MAT.lampBulb);
  sbLed.position.set(-0.16, 0.24, 0.02);
  scoreboard.add(sbLed);
  // 屏幕下方两个小按钮（操作感）
  for (const bx of [-0.06, 0.06]) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.007, 10), MAT.iron);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(bx, -0.02, 0.055);
    scoreboard.add(btn);
  }
  // 底座（短柱立在桌面）
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.12), MAT.ironDark);
  base.position.y = 0.012;
  scoreboard.add(base);
  // 位置：桌面右侧（放回桌上，不是墙边）；立正，正面朝玩家（+z）
  scoreboard.position.set(0.58, TABLE_H + 0.042, 0.02);   // 桌面内（右缘 0.8，宽 0.42 不超沿）
  scoreboard.rotation.y = -0.32;    // 屏面朝向玩家坐姿方位（不歪）
  scoreboard.rotation.x = 0;        // 立正（无前倾）
  table.add(scoreboard);

  add(table);               // 桌子整体加入场景

  // ================= 椅子 =================
  function makeChair(x, z, isMine) {
    const g = new THREE.Group();
    // 坐垫（带圆角分段）
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.5, 4, 1, 4), MAT.ironDark);
    seat.position.y = 0.46; seat.castShadow = true; g.add(seat);
    // 靠背
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.06, 1, 4, 1), MAT.iron);
    back.position.set(0, 0.82, -0.22); g.add(back);
    // 靠背横档
    for (let j = 0; j < 3; j++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.02), MAT.ironDark);
      slat.position.set(0, 0.55 + j * 0.16, -0.25);
      g.add(slat);
    }
    // 四条锥形腿
    for (const [sx, sz] of [[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.46, 8), MAT.iron);
      leg.position.set(sx, 0.23, sz); g.add(leg);
    }
    if (isMine) {
      // 玩家椅：扶手入镜
      for (const sx of [-0.24, 0.24]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.44), MAT.ironDark);
        arm.position.set(sx, 0.64, 0.02); g.add(arm);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 6), MAT.iron);
        post.position.set(sx, 0.52, 0.18); g.add(post);
      }
    }
    g.position.set(x, 0, z);
    // 朝向：自动面向桌心（近侧 z>0 面朝 -z；远侧 z<0 面朝 +z）
    g.rotation.y = z > 0 ? Math.PI : 0;
    return g;
  }
  add(makeChair(0, 1.35, true));     // 玩家椅：近侧正中，面朝桌子
  add(makeChair(0, -1.35, false));   // 恶魔椅：对面正中，面朝玩家

  // ================= 顶部光源（仅光，无实体——避免视野里出现"一坨"） =================
  // 主光已由 mainLight 承担；此处不再建任何可见灯体
  mainLight.position.set(0, 2.9, -0.6);


  // 尺寸适配
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer, scene, camera,
    mainLight,
    tableY: TABLE_H,
    tableW: TABLE_W, tableD: TABLE_D,
    start(loop) {
      const clock = new THREE.Clock();
      renderer.setAnimationLoop(() => loop(clock.getElapsedTime()));
    },
  };
}