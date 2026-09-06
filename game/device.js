/* 设备类型检测：desktop / tablet / mobile
 * 结果保存到 localStorage(wb_device)，并挂到 window.deviceType 供后续布局优化使用。
 * 当前版本只检测与保存，不改变任何布局。
 */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var isTablet = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua);
  var isMobile = !isTablet && /iPhone|iPod|Mobile|Android|Windows Phone|BlackBerry|IEMobile/i.test(ua);
  var type = isTablet ? 'tablet' : (isMobile ? 'mobile' : 'desktop');

  // 触摸能力辅助信号（部分平板 UA 不含 Tablet 字样）
  if (type === 'desktop' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1 &&
      /Macintosh|Windows|Linux/i.test(ua)) {
    type = 'tablet';
  }

  try {
    localStorage.setItem('wb_device', type);
  } catch (e) {}

  window.deviceType = type;
  document.documentElement.setAttribute('data-device', type);
})();
