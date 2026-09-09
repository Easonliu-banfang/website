/* 全站登录守卫（游戏室子页面共用）
 * - 未登录（localStorage 无 game_token）→ 跳 login.html?return=<当前页>
 * - 已登录 → 放行，并暴露 window.Auth = { user, logout, switchAccount }
 * - 主页（根 index.html）不引入本脚本，天然豁免
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'game_token';
  var NAME_KEY = 'game_username';

  function getToken() { try { return window.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function getUsername() { try { return window.localStorage.getItem(NAME_KEY); } catch (e) { return ''; } }

  // 当前页相对路径（含 query），用于登录后返回
  function currentPage() {
    var p = window.location.pathname;
    // 保留 /game/... 相对路径 + 参数
    var q = window.location.search;
    return encodeURIComponent(p + q);
  }

  // 守卫：未登录强制跳登录页
  (function guard() {
    var token = getToken();
    if (token) return;
    var login = 'login.html?return=' + currentPage();
    try { window.location.replace(login); } catch (e) { window.location.href = login; }
  })();

  // 提供给页面使用的账号 API（游戏室右上角菜单用）
  window.Auth = {
    user: getUsername(),
    isLoggedIn: function () { return !!getToken(); },
    // 退出登录：调服务端作废 token → 清本地 → 回主页
    logout: function () {
      var token = getToken();
      if (token) {
        try {
          fetch('https://quoridor-mp.pages.dev/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token }),
          }).catch(function () {});
        } catch (e) {}
      }
      clearLocal();
      window.location.href = '../index.html';
    },
    // 切换账号：清本地 → 回登录页
    switchAccount: function () {
      clearLocal();
      window.location.href = 'login.html';
    },
  };

  function clearLocal() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(NAME_KEY);
      window.localStorage.removeItem('game_skip_auth');
    } catch (e) {}
  }
})();
