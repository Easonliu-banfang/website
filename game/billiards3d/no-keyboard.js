/* 桌球3D 键盘抑制补丁（pool3d.html）v3 —— 性能优化版
 * 需求：对局中除「主动打开聊天输入」外，禁止一切键盘弹出。
 * 原理：仅放行「聊天 dialog 处于 open 状态时聚焦 #inputText」；
 *       其他文本输入聚焦 → immediate blur()（浏览器不弹软键盘）。
 * v3 优化（修复连续点击卡顿 + 保证聊天放行即时性）：
 *   - 非输入元素（div/canvas/button/body…）在 handler 首行直接返回，零 DOM 查询
 *   - dialog 元素缓存；open 状态仅在「目标确实是聊天框」时才查询（频次极低，无性能负担）
 *   - blur 前判断 document.activeElement，避免重复 blur 触发重绘
 */
(function () {
  'use strict';

  var CHAT_DIALOG_ID = 'inputTextDiv';
  var chatDialog = null;      // dialog 元素缓存（懒初始化）

  function isClickableNoKb(type) {
    // 不弹文字键盘的 input 类型 → 跳过
    return type === 'range' || type === 'color' || type === 'checkbox' || type === 'radio' ||
           type === 'button' || type === 'submit' || type === 'reset' || type === 'hidden' || type === 'file';
  }

  function onFocus(e) {
    var t = e.target;
    if (!t || !t.tagName) return;
    var tag = t.tagName;
    // 只关心文本输入类；其余元素零处理立即返回（无 DOM 查询 → 点屏幕不卡）
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !t.isContentEditable) return;

    if (tag === 'INPUT') {
      var ty = t.getAttribute ? (t.getAttribute('type') || 'text') : 'text';
      if (isClickableNoKb(ty.toLowerCase())) return;
    }

    // 放行唯一场景：聊天输入框且其 dialog 正处于 open（用户主动点打字/按 C）
    if (tag === 'INPUT' && t.id === 'inputText' || (t.closest && t.closest('#' + CHAT_DIALOG_ID))) {
      if (!chatDialog) chatDialog = document.getElementById(CHAT_DIALOG_ID);
      if (chatDialog && chatDialog.open) return;   // 仅聊天框聚焦时才查询 open：频次极低
    }

    // 其余文本输入：仅在确实持有焦点时 blur
    if (document.activeElement === t && t.blur) t.blur();
  }

  document.addEventListener('focusin', onFocus, true);
})();