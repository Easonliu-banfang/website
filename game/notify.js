/* 全局通知栏 v2（所有游戏共用）
 * 设计（按需求）：
 *   - 单槽、最新优先：新通知直接替换当前通知，不回滚旧通知
 *   - 常驻事件（重连中/断开/胜负）sticky=true，直到被新通知替换或 clear/clearAll 才消失
 *   - 胜负（win/lose）也走通知栏，sticky 常驻，直到退出/重开/悔棋（clearAll）
 *   - 颜色按严重程度分级 + 左右双色条（CSS）
 */
(function (global) {
  'use strict';

  var DEFAULT_TTL = { info: 4000, success: 3000, warn: 0, error: 0, win: 0, lose: 0 };  // 0 = 常驻（需配合 sticky）

  var bar = null;
  var current = null;    // 当前通知
  var timer = null;

  function ensureBar() {
    bar = document.getElementById('notifyBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'notifyBar';
      bar.className = 'notify-bar';
      bar.setAttribute('hidden', '');
      document.body.appendChild(bar);
    }
    return bar;
  }

  function render() {
    if (!bar) ensureBar();
    if (!bar) return;
    if (!current || !current.text) {
      bar.setAttribute('hidden', '');
      bar.textContent = '';
      return;
    }
    bar.removeAttribute('hidden');
    bar.textContent = current.text;
    bar.className = 'notify-bar notify-' + (current.type || 'info');
  }

  function killTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function schedule(type, customTtl) {
    killTimer();
    var ms = (type === 'custom') ? customTtl : DEFAULT_TTL[type];
    if (typeof ms === 'number' && ms > 0) timer = setTimeout(function () { dismiss(); }, ms);
  }

  // 当前通知结束 → 直接隐藏（不恢复任何旧通知）
  function dismiss() {
    if (!current) { render(); return; }
    killTimer();
    current = null;
    render();
  }

  /* ---------- API ---------- */

  // 回合提示：一次性临时通知，2.5 秒后自动消失（不再常驻）。回合变化时调用。
  function setTurn(text) {
    show(text, 'info', { ttl: 2500 });
  }

  // 事件通知：直接替换当前。type: info|success|warn|error|win|lose；opts.sticky=true 常驻；opts.ttl=自定义时长
  function show(text, type, opts) {
    ensureBar();
    opts = opts || {};
    if (current && current.text === text) {
      current.type = type || 'info';
      current.sticky = !!opts.sticky;
      render();
      schedule(opts.ttl != null ? 'custom' : (current.sticky ? 'none' : current.type), opts.ttl);
      return;
    }
    if (type === 'success') {
      // 问题已解决：清掉待展现的常驻事件（断开/重连/胜负），避免覆盖残留
      clearSticky();
      if (!current) { /* 刚刚清掉即是空 */ }
    }
    current = { text: text, type: type || 'info', sticky: !!opts.sticky };
    render();
    schedule(opts.ttl != null ? 'custom' : (current.sticky ? 'none' : current.type), opts.ttl);
  }

  // 清除指定文案的通知（事件解决）
  function clear(text) {
    if (current && current.text === text) dismiss();
  }

  // 清除常驻类通知（重连中/断开/胜负等）。连接成功 / 新局 / 悔棋时调用
  function clearSticky() {
    if (current && current.sticky) {
      killTimer();
      current = null;
    }
    render();
  }

  // 清空事件层 → 回落到回合指示（退出对局 / 重开 / 悔棋时清胜负）
  function clearAll() {
    killTimer();
    current = null;
    render();
  }

  function isShowing(text) { return !!(current && current.text === text); }

  global.Notify = {
    setTurn: setTurn,
    show: show,
    dismiss: dismiss,
    clear: clear,
    clearSticky: clearSticky,
    clearAll: clearAll,
    isShowing: isShowing
  };

  // 点击通知栏 = 手动结束当前事件通知（回落到回合指示）
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'notifyBar' && current) dismiss();
  });
})(typeof window !== 'undefined' ? window : globalThis);