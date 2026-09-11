/* 3D 八球台球 —— 全面汉化（意译，非机械直译）
 * 原理：游戏全部 UI 都是 DOM 文本（canvas 零绘字）。
 * 用一个"英文 → 自然中文"映射表 + MutationObserver 实时翻译：
 *   - 初次加载遍历全页
 *   - 之后监听 DOM 增删/文本变更，新出现的菜单/通知/按钮即时翻译
 * 长短语排前面，避免子串误伤（如 "Ball " 不能先于 "Ball in hand" 替换）。
 */
(function () {
  'use strict';
  if (window.__i18nZH) return;
  window.__i18nZH = true;

  /* 映射表：优先按词条长度从长到短处理 */
  var MAP = [
    // —— 对局结果 / 状态 ——
    ['YOU WON', '你赢了'],
    ['YOU LOST', '你输了'],
    ['GAME OVER', '本局结束'],
    ['Waiting for opponent to join', '等待对手加入…'],
    ['Waiting for opponent', '等待对手…'],
    ['Replay Complete', '回放完成'],
    ['Bot mode activated', '机器人模式已开启'],
    ['Concede Game', '认输'],
    ['You conceded', '你认输了'],
    ['Back to Arena', '返回竞技场'],
    ['Back to Lobby', '返回大厅'],
    // —— 规则判罚（台球术语，意译）——
    ['Ball in hand', '自由球（手中球）'],
    ['Cue ball potted', '白球落袋'],
    ['White potted', '白球落袋'],
    ['Black respotted', '黑八复位'],
    ['No cushion after contact', '击球后未碰库'],
    ['Wrong group hit first', '先击中了错误的一组球'],
    ['Wrong ball hit first', '先击中了错误的球'],
    ['Hit red instead of colour', '应先击打红球'],
    ['Red potted instead of colour', '误将红球打进'],
    ['No ball hit', '未击中任何球'],
    ['No pot', '未进球'],
    ['You first', '你先开球'],
    // —— 操作 / 菜单 ——
    ['Change camera angle', '切换视角'],
    ['Hide Preview', '隐藏预览'],
    ['Switch to emoji mode', '切换到表情模式'],
    ['Switch to text mode', '切换到文字模式'],
    ['Place Balls', '放置彩球'],
    ['Place White', '放置白球'],
    ['Place Red', '放置红球'],
    ['Place Yellow', '放置黄球'],
    ['Place Ball', '放置白球'],
    ['Switch Ball', '切换球'],
    ['Shot Analysis', '击球分析'],
    ['Step left', '左移一步'],
    ['Step right', '右移一步'],
    ['Whole Game', '整局'],
    // —— 彩球名 ——
    ['Black', '黑球'], ['Blue', '蓝球'], ['Brown', '棕球'],
    ['Green', '绿球'], ['Pink', '粉球'], ['Yellow', '黄球'],
    // —— 状态/提示 ——
    ['Pending', '等待中'],
    ['Unknown', '未知'],
    ['System error', '系统错误'],
    ['Network error or Load failed', '网络错误或加载失败'],
    ['Request timed out', '请求超时'],
    ['Could not shorten url', '无法生成分享链接'],
    ['Error shortening url', '生成分享链接出错'],
    ['Error submitting match result to', '战绩上报失败：'],
    ['Retrying match result submission in', '稍后重试上报战绩'],
    ['Publication error for table', '对局消息发布失败'],
    ['Failed to encode replay data', '回放数据编码失败'],
    ['Solution not found', '未找到解法'],
    ['Analysing', '正在分析'],
    ['Spectate', '观战'],
    ['Opponent', '对手'],
    ['Player', '玩家'],
    ['Anon', '匿名'],
    ['Send', '发送'],
    ['Replay', '回放'],
    ['Restore', '恢复'],
    ['Retry', '重试'],
    ['Preview', '预览'],
    ['Respot', '复位'],
    ['Score', '比分'],
    ['Info', '信息'],
    // —— 单短词（最后处理，长词已先行）——
    ['CONCEDE', '认输'], ['ABORT', '终止'], ['BEGIN', '开始'],
    ['COMPLETE', '完成'], ['REJOIN', '重新加入'], ['RERACK', '重新摆球'],
    ['BREAK', '开球'], ['FOUL', '犯规'],
    ['CHAT', '聊天'], ['SCORE', '比分'], ['ERROR', '错误'],
    ['NOTIFICATION', '通知'], ['PLACEBALL', '放置白球'],
    ['Break', '开球'], ['Foul', '犯规'],
    ['Shot', '击球'], ['Hit', '击中'], ['Potted', '打进'],
    ['Ball', '球'], ['Clear', '清除'], ['close', '关闭'], ['Close', '关闭'],
    ['hit', '击打'],
    ['Billiards', '台球'],
  ];

  function tr(s) {
    var out = s;
    for (var i = 0; i < MAP.length; i++) {
      var k = MAP[i][0], v = MAP[i][1];
      if (out.indexOf(k) >= 0) out = out.split(k).join(v);
    }
    // 清理中文字符相邻的多余空格（"打进 黑球" → "打进黑球"）
    out = out.replace(/\s+([\u4e00-\u9fff])/g, '$1').replace(/([\u4e00-\u9fff])\s+/g, '$1');
    return out;
  }

  var seen = new WeakSet();

  /* 本站域白名单：这些域算"自己人"，允许跳转 */
  var OUR_HOSTS = null;
  function ourHosts() {
    if (OUR_HOSTS) return OUR_HOSTS;
    OUR_HOSTS = { 'quoridor-mp.pages.dev': 1, 'easonliu-banfang.github.io': 1, 'billiards-network.onrender.com': 1 };
    try { if (location && location.host) OUR_HOSTS[location.host] = 1; } catch (e) {}
    return OUR_HOSTS;
  }
  function isExternalHref(href) {
    if (!href || href.indexOf('http') !== 0) return false;
    try {
      var host = new URL(href, location.href).host;
      return !!host && !ourHosts()[host];
    } catch (e) { return false; }
  }

  /* —— 外链兜底：删除跳转到本站之外的外链按钮 / 拦截 window.open —— */
  var OUR_HOSTS = { 'quoridor-mp.pages.dev': 1, 'easonliu-banfang.github.io': 1, 'billiards-network.onrender.com': 1 };
  function isExternalUrl(u) {
    try {
      var h = new URL(u, globalThis.location ? globalThis.location.href : undefined).host;
      if (!h) return false;
      if (globalThis.location && h === globalThis.location.host) return false;
      return !OUR_HOSTS[h];
    } catch (e) { return false; }
  }
  function removeExternalAnchors(root) {
    var as = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (isExternalUrl(a.getAttribute('href'))) {
        var p = a.parentNode;
        if (p) p.removeChild(a);
      }
    }
  }
  try {
    var _open = window.open;
    window.open = function (u) {
      if (typeof u === 'string' && isExternalUrl(u)) return null;
      return _open.apply(window, arguments);
    };
  } catch (e) {}

  function translateNode(node) {
    if (node.nodeType === 3) { // 文本节点
      var v = node.nodeValue;
      var o = tr(v);
      if (o !== v) node.nodeValue = o;
      return;
    }
    if (node.nodeType === 1) {
      var t = node.getAttribute('title');
      if (t) { var t2 = tr(t); if (t2 !== t) node.setAttribute('title', t2); }
      var ph = node.getAttribute('placeholder');
      if (ph) { var p2 = tr(ph); if (p2 !== ph) node.setAttribute('placeholder', p2); }
      var al = node.getAttribute('aria-label');
      if (al) { var a2 = tr(al); if (a2 !== al) node.setAttribute('aria-label', a2); }
    }
  }

  function walk(root) {
    var skip = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CANVAS: 1, NOSCRIPT: 1 };
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (seen.has(n)) continue;
      seen.add(n);
      var el = n.parentElement;
      if (!el || skip[el.tagName]) continue;
      translateNode(n);
    }
    var els = root.querySelectorAll ? root.querySelectorAll('[title],[placeholder],[aria-label]') : [];
    for (var i = 0; i < els.length; i++) translateNode(els[i]);
    removeExternalAnchors(root);   // 外链按钮兜底清除
  }

  function boot() {
    var root = document.body || document.documentElement;
    if (!root) return;
    walk(root);
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var add = ms[i].addedNodes;
        if (!add) continue;
        for (var j = 0; j < add.length; j++) {
          if (add[j].nodeType === 1 || add[j].nodeType === 3) walk(add[j]);
        }
        if (ms[i].type === 'characterData') translateNode(ms[i].target);
      }
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();