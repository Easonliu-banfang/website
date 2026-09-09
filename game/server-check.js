/* 服务器状态指示器（顶栏「⚡ 服务器状态」按钮）
 * - 每 60 秒探一次 Worker /api/status
 * - 单次探测 20 秒内没结果 → 视为不可用：按钮变红 + 放大 + 文案「服务不可用」
 * - 恢复后自动回到正常青色状态
 */
(function () {
  'use strict';

  var API = 'https://quoridor-mp.pages.dev/api/status?t=';
  var TIMEOUT_MS = 20000;      // 20 秒超时判定
  var INTERVAL_MS = 60000;     // 每 60 秒重探

  var btn = null;
  var timer = null;

  function findBtn() {
    // 顶栏状态按钮（游戏室 index.html 等）
    btn = document.querySelector('.status-btn');
    return btn;
  }

  function setDown() {
    if (!btn) return;
    btn.classList.add('status-down');
    btn.textContent = '⚠ 服务不可用';
    btn.setAttribute('title', '服务器 20 秒内无响应，请稍后重试');
  }

  function setUp() {
    if (!btn) return;
    btn.classList.remove('status-down');
    btn.textContent = '⚡ 服务器状态';
    btn.removeAttribute('title');
  }

  // 带超时的探测
  function probe() {
    return new Promise(function (resolve) {
      var done = false;
      var to = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(false);        // 20 秒超时 → 不可用
      }, TIMEOUT_MS);

      fetch(API + Date.now(), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          if (done) return;
          done = true;
          clearTimeout(to);
          resolve(!(d && d.error));
        })
        .catch(function () {
          // 实时接口失败 → 兜底静态 JSON（有数据也算可用）
          return fetch('server-status.json?v=b1', { cache: 'no-store' })
            .then(function (r2) { if (!r2.ok) throw new Error(); return r2.json(); })
            .then(function () {
              if (done) return;
              done = true;
              clearTimeout(to);
              resolve(true);
            })
            .catch(function () {
              if (done) return;
              done = true;
              clearTimeout(to);
              resolve(false);
            });
        });
    });
  }

  function tick() {
    probe().then(function (ok) {
      if (ok) setUp();
      else setDown();
    });
  }

  function boot() {
    if (!findBtn()) return;    // 本页没有状态按钮，不启用
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, INTERVAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
