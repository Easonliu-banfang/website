/* 双人同屏昵称共享工具（local2p-name.html 写入 localStorage 'local2p_names'）
 * 用途：5 款棋牌类游戏（quoridor/connect4/battleship/gomoku/go）本地双人模式下，
 *       把「玩家一/玩家二」显示替换为用户在昵称页输入的昵称。
 * 用法：在 app.js 之前加载本脚本，然后 window.Local2P.p1() / p2()。
 * 无昵称时优雅回退「玩家一/玩家二」，不影响非双人模式。
 */
(function () {
  'use strict';

  function load() {
    try {
      var raw = localStorage.getItem('local2p_names');
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : null;
    } catch (e) {
      return null;
    }
  }

  var saved = load();

  window.Local2P = {
    p1: function () { return (saved && saved.p1 && String(saved.p1).trim()) || '玩家一'; },
    p2: function () { return (saved && saved.p2 && String(saved.p2).trim()) || '玩家二'; },
    has: function () { return !!(saved && saved.p1 && saved.p2); }
  };
})();