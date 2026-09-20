/* 恶魔轮盘 · 程序化 Canvas 纹理生成器
 * 纯代码生成贴图（零外部资源）：
 *   - woodGrain()  深胡桃木横纹（桌面用）
 *   - ironPlate()  金属拉丝/锈斑（枪托座/计数机用）
 *   - felt()       深红毛毡（枪位衬垫/道具格底）
 *   - screenText() 数字显示屏（计数机「充能电量」数字）
 *   - concrete()   水泥噪点
 */
import * as THREE from '../lib/three.module.min.js';

function canvasTex(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const rnd = (a, b) => a + Math.random() * (b - a);

/* 深胡桃木：横木板 + 几道年轮/划痕 */
export function woodGrain(size = 512) {
  return canvasTex(size, (ctx, s) => {
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(0, 0, s, s);
    // 木纹底色渐变
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#4e3522');
    g.addColorStop(0.5, '#452c1b');
    g.addColorStop(1, '#503823');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // 横向年轮线
    for (let i = 0; i < 26; i++) {
      const y = rnd(0, s);
      ctx.strokeStyle = `rgba(${rnd(20, 45)},${rnd(12, 28)},${rnd(6, 16)},${rnd(0.08, 0.22)})`;
      ctx.lineWidth = rnd(0.6, 2.4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 24) ctx.lineTo(x, y + Math.sin(x / 60 + rnd(0, 6)) * rnd(1, 4));
      ctx.stroke();
    }
    // 深结节
    for (let i = 0; i < 5; i++) {
      const x = rnd(40, s - 40), y = rnd(40, s - 40), r = rnd(5, 12);
      const ng = ctx.createRadialGradient(x, y, 1, x, y, r);
      ng.addColorStop(0, '#22150b');
      ng.addColorStop(1, 'rgba(34,21,11,0.2)');
      ctx.fillStyle = ng;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 划痕/磨损
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(200,170,120,${rnd(0.05, 0.14)})`;
      ctx.lineWidth = rnd(0.5, 1.2);
      ctx.beginPath();
      ctx.moveTo(rnd(0, s), rnd(0, s));
      ctx.lineTo(rnd(0, s), rnd(0, s));
      ctx.stroke();
    }
  });
}

/* 金属：暗色 + 拉丝 + 锈斑 + 磕痕 */
export function ironPlate(size = 512) {
  return canvasTex(size, (ctx, s) => {
    ctx.fillStyle = '#2c2f3a';
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#32363f');
    g.addColorStop(1, '#262933');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // 竖向拉丝
    for (let i = 0; i < 120; i++) {
      const x = rnd(0, s);
      ctx.strokeStyle = `rgba(${rnd(150, 195)},${rnd(150, 195)},${rnd(165, 205)},${rnd(0.04, 0.12)})`;
      ctx.lineWidth = rnd(0.3, 0.9);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke();
    }
    // 锈斑/油渍
    for (let i = 0; i < 10; i++) {
      const x = rnd(0, s), y = rnd(0, s), r = rnd(6, 20);
      const rg = ctx.createRadialGradient(x, y, 1, x, y, r);
      rg.addColorStop(0, `rgba(${rnd(90, 120)},${rnd(50, 70)},${rnd(30, 45)},${rnd(0.12, 0.28)})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}

/* 深红毛毡（枪位/道具格底衬） */
export function felt(size = 256) {
  return canvasTex(size, (ctx, s) => {
    ctx.fillStyle = '#6d1a2a';
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, s / 6, s / 2, s / 2, s);
    g.addColorStop(0, '#7d2033');
    g.addColorStop(1, '#5a1522');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // 绒毛噪点
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = `rgba(${rnd(120, 150)},${rnd(28, 48)},${rnd(42, 62)},${rnd(0.1, 0.35)})`;
      ctx.fillRect(rnd(0, s), rnd(0, s), 1, 1);
    }
  });
}

/* 数字屏：深底 + 绿色充能数字（count 文本） */
export function screenText(text, bg = '#081009', fg = '#59c98a', size = 256) {
  return canvasTex(size, (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    // 绿字符（像素风字形）
    ctx.fillStyle = 'rgba(60,160,100,0.35)';
    for (let i = 0; i < 300; i++) ctx.fillRect(rnd(0, s), rnd(0, s), 2, 1);
    ctx.fillStyle = fg;
    ctx.font = '700 ' + Math.floor(s * 0.55) + 'px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = fg;
    ctx.shadowBlur = s * 0.08;
    ctx.fillText(String(text), s / 2, s / 2 + s * 0.04);
    // 顶部小标签
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(120,200,150,0.55)';
    ctx.font = '700 ' + Math.floor(s * 0.13) + 'px monospace';
    ctx.fillText('CHARGE', s / 2, s * 0.13);
  });
}

/* 双数字屏：左=对手命数(红) 右=我的命数(绿)，中间竖分隔线（记分牌正面用） */
export function screenDual(foeLives, myLives, size = 256) {
  return canvasTex(size, (ctx, s) => {
    // 底
    ctx.fillStyle = '#08100e';
    ctx.fillRect(0, 0, s, s);
    // 扫描线质感
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${rnd(80, 140)},${rnd(120, 180)},${rnd(110, 170)},0.12)`;
      ctx.fillRect(0, rnd(0, s), s, 1);
    }
    // 中间竖分隔
    ctx.fillStyle = 'rgba(200,220,210,0.35)';
    ctx.fillRect(s / 2 - 1, s * 0.16, 2, s * 0.68);
    // 左：对手（红）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff4f5e';
    ctx.shadowBlur = s * 0.09;
    ctx.fillStyle = '#ff5c6c';
    ctx.font = '700 ' + Math.floor(s * 0.5) + 'px "SF Mono", monospace';
    ctx.fillText(String(foeLives), s * 0.27, s * 0.46);
    // 右：我（绿）
    ctx.shadowColor = '#59c98a';
    ctx.shadowBlur = s * 0.09;
    ctx.fillStyle = '#59c98a';
    ctx.fillText(String(myLives), s * 0.73, s * 0.46);
    // 顶部标签：FOE / YOU
    ctx.shadowBlur = 0;
    ctx.font = '700 ' + Math.floor(s * 0.1) + 'px monospace';
    ctx.fillStyle = 'rgba(255,120,130,0.7)';
    ctx.fillText('FOE', s * 0.27, s * 0.14);
    ctx.fillStyle = 'rgba(120,220,170,0.75)';
    ctx.fillText('GAMER', s * 0.73, s * 0.14);
    // 底边小刻度（装饰）
    ctx.fillStyle = 'rgba(150,200,180,0.25)';
    for (let i = 0; i < 10; i++) ctx.fillRect(s * 0.08 + i * s * 0.084, s * 0.86, s * 0.05, 2);
  });
}

/* 水泥噪点 */
export function concrete(size = 512) {
  return canvasTex(size, (ctx, s) => {
    ctx.fillStyle = '#2a2d38';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) {
      const v = rnd(30, 80);
      ctx.fillStyle = `rgba(${v},${v + 6},${v + 16},${rnd(0.15, 0.4)})`;
      ctx.fillRect(rnd(0, s), rnd(0, s), 2, 2);
    }
    // 污渍
    for (let i = 0; i < 8; i++) {
      const x = rnd(0, s), y = rnd(0, s), r = rnd(20, 50);
      const rg = ctx.createRadialGradient(x, y, 2, x, y, r);
      rg.addColorStop(0, 'rgba(10,10,16,0.25)');
      rg.addColorStop(1, 'rgba(10,10,16,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}