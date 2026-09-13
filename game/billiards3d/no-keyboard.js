/* 桌球3D 键盘抑制补丁（pool3d.html）
 * 需求：对局中除「主动打开聊天输入」外，强制禁止所有键盘弹出。
 * 原理：全局捕获 focusin，仅放行「聊天 dialog 处于 open 状态时聚焦 #inputText」；
 *       其他文本类输入获得焦点 → 立即 blur()（浏览器通常不会弹软键盘）。
 * 说明：range/color/checkbox/button 等不弹文字键盘的类型不干预，
 *       避免打断力度滑杆拖动等操作；readonly 输入本就无键盘。
 */
(function () {
  'use strict';

  var CHAT_DIALOG = 'inputTextDiv';

  function chatDialogOpen() {
    var d = document.getElementById(CHAT_DIALOG);
    return !!(d && d.open);
  }

  // 只抑制会弹文字键盘的元素
  function textTyping(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName.toLowerCase();
    if (t === 'textarea' || t === 'select') return true;
    if (t === 'input') {
      var ty = (el.getAttribute('type') || 'text').toLowerCase();
      // 文本类：text/search/tel/url/email/password/number 等；range/color/checkbox/button/file/hidden 不弹文字键盘
      if (ty === 'range' || ty === 'color' || ty === 'checkbox' || ty === 'radio' ||
          ty === 'button' || ty === 'submit' || ty === 'reset' || ty === 'hidden' ||
          ty === 'file') return false;
      return true;
    }
    return el.isContentEditable === true;
  }

  function onFocus(e) {
    var el = e.target;
    if (!textTyping(el)) return;
    // 放行唯一场景：聊天输入框且其 dialog 处于 open（用户主动点打字按钮 / 按 C）
    var inChat = el.closest && el.closest('dialog') === document.getElementById(CHAT_DIALOG);
    if (inChat && chatDialogOpen()) return;
    // 其余情况：立即失焦，阻止键盘弹出
    if (el.blur) el.blur();
  }

  // focusin（捕获阶段）在浏览器拉起软键盘之前执行
  document.addEventListener('focusin', onFocus, true);
})();