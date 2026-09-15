/* 恶魔轮盘 · WebAudio 程序化音效（零外部资源）
 *   - fireShot()   霰弹枪开火（噪声爆音 + 低频冲击）
 *   - pump()       泵动上膛（两段 click）
 *   - blank()      空弹撞针（金属咔嗒 + 回声）
 *   - hit()        命中（闷响 + 血液低频）
 *   - dry()        弹仓空（咔哒）
 *   - item()       道具使用（电子滴声）
 *   - uiClick()    UI 点击
 * 懒初始化 AudioContext（首次用户交互后才创建）
 */
let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c, dur) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
  return buf;
}

/** 开枪：噪声爆音 + 低频冲击 */
export function fireShot() {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime;

  // 主爆音（白噪声，高通扫频）
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.28);
  const bp = c.createBiquadFilter(); bp.type = 'lowpass';
  bp.frequency.setValueAtTime(2600, t0);
  bp.frequency.exponentialRampToValueAtTime(180, t0 + 0.22);
  const g = c.createGain();
  g.gain.setValueAtTime(0.9, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t0);

  // 低频冲击（枪托后坐感）
  const osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(95, t0);
  osc.frequency.exponentialRampToValueAtTime(30, t0 + 0.14);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.85, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  osc.connect(g2).connect(c.destination);
  osc.start(t0); osc.stop(t0 + 0.18);
}

/** 泵动上膛：两段 click（后拉 + 前推） */
export function pump() {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime;
  for (const [t, f] of [[0, 900], [0.12, 500]]) {
    const osc = c.createOscillator(); osc.type = 'square';
    osc.frequency.setValueAtTime(f, t0 + t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t0 + t);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + t + 0.05);
    osc.connect(g).connect(c.destination);
    osc.start(t0 + t); osc.stop(t0 + t + 0.06);
  }
}

/** 空弹撞针：金属咔嗒 + 短回声 */
export function blank() {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(1400, t0);
  osc.frequency.exponentialRampToValueAtTime(500, t0 + 0.05);
  const g = c.createGain();
  g.gain.setValueAtTime(0.5, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  osc.connect(g).connect(c.destination);
  osc.start(t0); osc.stop(t0 + 0.12);
  // 回声（延迟）
  const e = c.createDelay(); e.delayTime.value = 0.14;
  const g2 = c.createGain(); g2.gain.value = 0.25;
  osc.connect(e).connect(g2).connect(c.destination);
}

/** 命中（实弹打中）：闷响 + 低频重击 */
export function hit() {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(75, t0);
  osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.22);
  const g = c.createGain();
  g.gain.setValueAtTime(0.9, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
  osc.connect(g).connect(c.destination);
  osc.start(t0); osc.stop(t0 + 0.26);

  // 血溅噪声短促
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.08);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.4, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
  src.connect(bp).connect(g2).connect(c.destination);
  src.start(t0);
}

/** 弹仓空（干扳机） */
export function dry() {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator(); osc.type = 'square';
  osc.frequency.setValueAtTime(300, t0);
  const g = c.createGain();
  g.gain.setValueAtTime(0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
  osc.connect(g).connect(c.destination);
  osc.start(t0); osc.stop(t0 + 0.05);
}

/** 道具使用：电子滴声 */
export function item() {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(620 + i * 260, t0 + i * 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.22, t0 + i * 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.08 + 0.12);
    osc.connect(g).connect(c.destination);
    osc.start(t0 + i * 0.08); osc.stop(t0 + i * 0.08 + 0.14);
  }
}

/** UI 点击 */
export function uiClick() {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(480, t0);
  osc.frequency.exponentialRampToValueAtTime(240, t0 + 0.06);
  const g = c.createGain();
  g.gain.setValueAtTime(0.14, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
  osc.connect(g).connect(c.destination);
  osc.start(t0); osc.stop(t0 + 0.08);
}
