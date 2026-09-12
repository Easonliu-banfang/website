/* 3D 八球台球 —— 汉化已全部在 index.js 源码层完成（字符串字面量直接替换）。
 * 本文件保留为空壳（各页面仍引用 i18n-zh.js，删除会 404）。
 * 不再做 MutationObserver 实时翻译。
 */
(function () {
  'use strict';
  if (window.__i18nZH) return;
  window.__i18nZH = true;
  // 仅保留极少数动态拼接文本的兜底（运行时才拼出来的、源码里无完整字面量的）
  var MAP = [
    ['Ball ', '球 '],
    [' vs ', ' 对阵 '],
  ];
  window.__i18nZH = MAP;
})();
