/* 全局通知栏（所有游戏共用）
 * 设计（按需求）：
 *   - 顶部居中宽条，始终只显示「最新一条」通知
 *   - 新通知到达 → 旧通知压入历史栈（暂停），显示最新
 *   - 当前通知失效（计时到 / 手动点击）→ 回滚显示上一条，直到栈空隐藏
 *   - notify(text) 解决/清除某条通知（如连接成功清掉「重连中」），避免回滚到已解决项
 *   - 颜色按严重程度分级：info 青 / success 绿 / warn 橙 / error 红
 *   - 自动消失时长：普通 4s；sticky（如重连中/断开）不自动消失，等新通知覆盖或 notify() 清除
 */
(function (global) {
  'use strict';

  var DEFAULT_TTL = { info: 4000, success: 3000, warn: 0, error: 0 };  // 0 = 常驻不自动消失
  var bar = null;

  function ensureBar() {
    bar = document.getElementById('notifyBar');
    if (bar) return true;
    // 页面未放置容器时兜底创建
    bar = document.createElement('div');
    bar.id = 'notifyBar';
    bar.className = 'notify-bar';
    bar.setAttribute('hidden', '');
    document.body.appendChild(bar);
    return true;
  }

  function render() {
    if (!current) { bar.setAttribute('hidden', ''); bar.textContent = ''; return; }
    bar.removeAttribute('hidden');
    bar.textContent = current.text;
    bar.className = 'notify-bar notify-' + current.type;
  }

  var current = null;   // 当前显示的通知
  var stack = [];       // 被覆盖的旧通知（待回滚）
  var timer = null;
  var sticky = false;

  function killTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function ttlFor(n) {
    if (n.sticky) return 0;
    var t = DEFAULT_TTL[n.type];
    return (typeof t === 'number' && t > 0) ? t : 0;
  }

  function restartTimer(ms) {
    killTimer();
    if (ms > 0) timer = setTimeout(function () { dismissCurrent(); }, ms);
  }

  function dismissCurrent() {
    killTimer();
    if (stack.length) {
      current = stack.pop();          // 回滚到上一条
      sticky = !!current.sticky;
      render();
      restartTimer(ttlFor(current));
    } else {
      current = null; sticky = false;
      render();
    }
  }

  /* ---------- 对外 API ---------- */

  // 显示/更新一条通知。type: info|success|warn|error；opts.sticky=true 不自动消失
  function show(text, type, opts) {
    ensureBar();
    opts = opts || {};
    if (current && current.text === text) {
      // 同一条：仅刷新类型与计时（防抖，不重复入栈）
      current.type = type || 'info';
      sticky = !!opts.sticky;
      render();
      restartTimer(opts.sticky ? 0 : (ttlFor(current) || DEFAULT_TTL.info));
      return;
    }
    // success = 问题已解决：先把待回滚的常驻通知清掉，
    // 避免「已连接」消失后又弹回「断开/重连中」
    if (type === 'success') clearSticky();
    if (current) stack.push({ text: current.text, type: current.type, sticky: sticky });
    current = { text: text, type: type || 'info' };
    sticky = !!opts.sticky;
    render();
    restartTimer(opts.sticky ? 0 : (ttlFor(current) || DEFAULT_TTL.info));
  }

  // 解决某条通知（连接成功等事件）：
  // 把该条从栈中移除；若是当前项则立即回滚到上一条
  function clear(text) {
    stack = stack.filter(function (n) { return n.text !== text; });
    if (current && current.text === text) dismissCurrent();
  }

  // 清除所有「常驻」类通知（warn/error 等已解决的事件）：
  // 连接成功时调用，避免 success 消息消失后又回滚出「重连中/已断开」
  function clearSticky() {
    stack = stack.filter(function (n) { return !n.sticky; });
    if (current && sticky) {
      killTimer();
      current = null; sticky = false;
      render();
    }
  }

  // 立即关闭当前通知并回滚
  function dismiss() { if (current) dismissCurrent(); }

  // 当前是否正在显示某条
  function isShowing(text) { return !!(current && current.text === text); }

  global.Notify = { show: show, clear: clear, clearSticky: clearSticky, dismiss: dismiss, isShowing: isShowing };

  // 点击通知 = 手动解决当前
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'notifyBar' && current) dismissCurrent();
  });
})(typeof window !== 'undefined' ? window : globalThis);