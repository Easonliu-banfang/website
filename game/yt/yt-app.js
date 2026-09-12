/* 顶哪个羊 —— 前端应用
 * 模式：online（联机 Worker 房间）/ local（同设备双人）/ ai（对 AI）
 * 渲染：Canvas 插值动画（yt-render.js）；服务端权威模拟 + 客户端 yt_sync 节拍（联机）
 */
(function () {
  'use strict';

  var q = {};
  location.search.replace(/[?&]([^=]+)=([^&]*)/g, function (_, k, v) { q[k] = decodeURIComponent(v); });

  var o = null;                 // 联机客户端
  var lobby = null;
  var mode = 'ai';
  var me = 0;                   // 我的槽位（0=左 1=右）
  var isHost = false;
  var currentRoom = q.room || '';
  var view = null;              // 服务端/本地视图
  var localState = null;        // 本地模式的引擎全量状态
  var selected = null;          // { slot, lv }
  var round = null;
  var syncTimer = null, aiTimer = null;
  var names = null;
  var lastHp = null;

  var el = {};
  function $(id) { return document.getElementById(id); }

  /* ---------- 手牌渲染 ---------- */
  var ICON = (window.YTRender && YTRender.ICON) || ['', '🐑', '🐐', '🐏', '🐏'];
  function sheepHtml(lv, slot, idx) {
    var selCls = (selected && selected.slot === slot && selected.idx === idx) ? ' sel' : '';
    return '<div class="yt-sheep lv' + lv + selCls + '" data-lv="' + lv + '" data-slot="' + slot + '" data-idx="' + idx + '">' +
      '<span class="ico">' + (ICON[lv] || '🐑') + '</span><span class="lv">' + lv + ' 力</span></div>';
  }
  // 自动选中手牌第一只（最小的羊）→ 点赛道即可直接放，省一步
  function autoSelectFirst() {
    if (selected) return;
    if (mode === 'local') {
      var h0 = (localState && localState.hands[0]) || [];
      if (h0.length) {
        var sorted0 = h0.slice().sort(function (a, b) { return a - b; });
        selected = { slot: 0, lv: sorted0[0], idx: h0.indexOf(sorted0[0]) };
      }
    } else if (view && view.hand && view.hand.length) {
      var sorted = view.hand.slice().sort(function (a, b) { return a - b; });
      selected = { slot: me, lv: sorted[0], idx: 0 };
    }
  }

  function renderHand() {
    var box = $('myHand');
    if (!view) { box.innerHTML = ''; return; }
    var isLocalDual = (mode === 'local');       // 面对面：显示两方手牌
    var html = '';
    if (isLocalDual) {
      html += '<div class="yt-hand-group" style="width:100%">' +
        '<div class="yt-sub" style="margin:2px 0 4px">左方（玩家 1）手牌</div>' +
        '<div class="yt-hand" data-slot="0">' + ((localState.hands[0] || []).map(function (lv, i) { return sheepHtml(lv, 0, i); }).join('') || '<span class="yt-hand-empty">暂无羊，等待补充…</span>') + '</div>' +
        '<div class="yt-sub" style="margin:8px 0 4px">右方（玩家 2）手牌</div>' +
        '<div class="yt-hand" data-slot="1">' + ((localState.hands[1] || []).map(function (lv, i) { return sheepHtml(lv, 1, i); }).join('') || '<span class="yt-hand-empty">暂无羊，等待补充…</span>') + '</div>' +
        '</div>';
    } else {
      var hand = (view.hand || []).slice().sort(function (a, b) { return a - b; });
      html = hand.length
        ? hand.map(function (lv, i) { return sheepHtml(lv, me, i); }).join('')
        : '<span class="yt-hand-empty">暂无羊，等待补充…</span>';
    }
    box.innerHTML = html;
    renderLaneBtns();
  }

  function laneReadyAt(lane, slot) {
    if (!view || !view.cool) return 0;
    return (view.cool[slot] && view.cool[slot][lane]) || 0;
  }
  function renderLaneBtns() {
    var box = $('laneBtns');
    if (!view) { box.innerHTML = ''; return; }
    var slot = selected ? selected.slot : me;
    var now = Date.now();
    var html = '';
    for (var i = 0; i < (view.lanes || 4); i++) {
      var left = Math.max(0, laneReadyAt(i, slot) - now) / 1000;
      var cls = left > 0 ? ' cool' : '';
      html += '<button class="yt-lane-btn' + cls + '" data-lane="' + i + '"' + (left > 0 ? ' disabled' : '') + '>' +
        '赛道 ' + (i + 1) + (left > 0 ? '<br>' + left.toFixed(1) + 's' : '') + '</button>';
    }
    box.innerHTML = html;
  }

  function renderHud() {
    if (!view) return;
    var hp = view.hp || [100, 100];
    // 视角：guest 翻转时左右互换
    var flip = (mode === 'online' && me === 1);
    var lHp = flip ? hp[1] : hp[0], rHp = flip ? hp[0] : hp[1];
    $('hpNumL').textContent = Math.max(0, Math.round(lHp));
    $('hpNumR').textContent = Math.max(0, Math.round(rHp));
    $('hpFillL').style.width = Math.max(0, Math.min(100, lHp)) + '%';
    $('hpFillR').style.width = Math.max(0, Math.min(100, rHp)) + '%';
    var myName = (names && names[flip ? 1 : 0]) || (flip ? '对手' : '我方');
    var foeName = (names && names[flip ? 0 : 1]) || (mode === 'ai' ? 'AI 羊群' : '对手');
    $('hpNameL').textContent = flip ? foeName : myName;
    $('hpNameR').textContent = flip ? myName : foeName;
  }

  function renderAll() {
    $('gameRoot').hidden = false;
    if (lobby) lobby.hide();
    renderHud(); renderHand();
    if (view && view.winner >= 0) showResult();
  }

  function tip(msg, warn) {
    var t = $('fieldTip');
    t.textContent = msg;
    t.className = 'yt-tip' + (warn ? ' warn' : '');
  }

  function showResult() {
    var flip = (mode === 'online' && me === 1);
    var mySlot = flip ? 1 : 0;
    var win = (view.winner === mySlot);
    if (mode === 'local') { $('resultTitle').textContent = (view.winner === 0 ? '左方（玩家 1）获胜！' : '右方（玩家 2）获胜！'); }
    else $('resultTitle').textContent = win ? '🎉 你赢了！' : '😵 你输了';
    $('resultDesc').textContent = '对手血量被打到 0' + (win ? '，羊群冲垮了对方基地！' : '，下次多铺几条赛道吧。');
    $('ytResult').hidden = false;
  }

  /* ---------- 交互：选羊 + 投放 ---------- */
  function selectSheep(slot, lv, idx) {
    if (selected && selected.slot === slot && selected.idx === idx) selected = null;
    else selected = { slot: slot, lv: lv, idx: idx };
    renderHand();
    if (selected) tip('已选中 ' + selected.lv + ' 力羊 —— 点击赛道放出（换羊请点其他羊）');
    else tip('点选手中的羊，再点赛道放出 →');
  }

  function doDeploy(lane) {
    if (!selected) { tip('先点一只羊选中，再点赛道', true); return; }
    if (!view || view.winner >= 0) return;
    if (lane < 0 || lane >= (view.lanes || 4)) return;

    if (mode === 'online') {
      if (selected.slot !== me) { selected = null; renderHand(); return; }
      if (o) o.send({ type: 'yt_deploy', lane: lane, lv: selected.lv });
    } else {
      localDeploy(selected.slot, selected.lv, lane);
    }
    selected = null;
    renderHand();
  }

  function localDeploy(slot, lv, lane) {
    var r = YT.deploy(localState, slot, lv, lane, Date.now());
    if (!r.ok) tip(r.error, true);
    else tip('已放出 ' + lv + ' 力羊 → 赛道 ' + (lane + 1));
    refreshLocal();
  }

  function refreshLocal() {
    YT.simulate(localState, Date.now());
    view = YT.viewFor(localState, (mode === 'local') ? 0 : me, Date.now());
    if (mode === 'local') view.handCount = [localState.hands[0].length, localState.hands[1].length];
    autoSelectFirst();
    renderAll();
  }

  function bindUI() {
    $('myHand').addEventListener('click', function (e) {
      var s = e.target.closest('.yt-sheep');
      if (!s) return;
      var lv = Number(s.getAttribute('data-lv'));
      var idx = Number(s.getAttribute('data-idx'));
      if (mode === 'local') selectSheep(Number(s.getAttribute('data-slot')), lv, idx);
      else selectSheep(me, lv, idx);
    });
    $('laneBtns').addEventListener('click', function (e) {
      var b = e.target.closest('.yt-lane-btn');
      if (!b || b.disabled) return;
      doDeploy(Number(b.getAttribute('data-lane')));
    });
    // 点场地直接投放（按 y 坐标换算赛道）
    $('ytCanvas').addEventListener('click', function (e) {
      if (!view) return;
      var r = e.currentTarget.getBoundingClientRect();
      var y = e.clientY - r.top;
      var padY = 34, laneH = (r.height - padY * 2) / (view.lanes || 4);
      var lane = Math.floor((y - padY) / laneH);
      lane = Math.max(0, Math.min((view.lanes || 4) - 1, lane));
      doDeploy(lane);
    });
    $('btnNew').addEventListener('click', function () {
      if (mode === 'online') {
        if (isHost && o) o.send({ type: 'reset' });
      } else startLocal();
    });
    $('btnAgain').addEventListener('click', function () {
      $('ytResult').hidden = true;
      if (mode === 'online') { if (isHost && o) o.send({ type: 'reset' }); }
      else startLocal();
    });
    $('btnLeave2').addEventListener('click', function () {
      if (o) o.sendLeave();
      location.href = 'yt.html';
    });
  }

  /* ---------- 本地模式（面对面 / AI） ---------- */
  function startLocal() {
    localState = YT.createState(4);
    YT.start(localState, Date.now(), Math.random);
    me = 0;
    names = (mode === 'ai') ? ['你', 'AI 羊群'] : ['玩家 1', '玩家 2'];
    $('ytResult').hidden = true;
    selected = null;
    refreshLocal();
    tip(mode === 'ai' ? '点你的羊 → 点赛道放出，把 AI 的血打到 0！' : '左方与右方各自选羊投放');
    if (mode === 'ai') startAI();
  }

  function startAI() {
    if (aiTimer) clearInterval(aiTimer);
    aiTimer = setInterval(function () {
      if (!localState || localState.winner >= 0) return;
      YT.simulate(localState, Date.now());
      if (!window.YtAI) return;
      var act = window.YtAI.decide(localState, 1, Date.now());
      if (act) YT.deploy(localState, 1, act.lv, act.lane, Date.now());
      refreshLocal();
    }, 700);
  }

  /* ---------- 联机模式 ---------- */
  function sendSync() {
    if (o && o.ws && o.ws.readyState === 1) o.send({ type: 'yt_sync' });
  }
  function startSync() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(sendSync, 500);
    sendSync();
  }

  function bindOnline(online) {
    online.on('welcome', function () {
      if (lobby) { lobby.show(currentRoom); lobby.setStatus('已连接，等待准备开始', 'connected'); }
    });
    online.on('lobby', function (d) {
      me = d.you;
      names = (d.names && d.names.length) ? d.names : null;
      isHost = (me === d.host) || (d.host == null && me === 0);
      var started = !!d.started;
      if (lobby) {
        if (started) lobby.hide();
        else {
          if (view) { view = null; $('gameRoot').hidden = true; }
          lobby.show(currentRoom);
          lobby.render(d);
        }
      }
    });
    online.on('started', function () {
      if (lobby) lobby.hide();
      startSync();
    });
    online.on('state', function (s) {
      if (!s) return;
      view = s;
      if (s.you != null) me = s.you;
      if (s.handCount) view.handCount = s.handCount;
      autoSelectFirst();
      renderAll();
    });
    online.on('error', function (m) { if (m) tip(m, true); });
    online.on('players', function () { /* 联机对局中不额外处理 */ });
    online.on('dissolve', function () {
      if (online) online._intentionalClose = true;
      if (window.Notify) { window.Notify.clearAll(); window.Notify.show('房间已解散，返回大厅…', 'error', { sticky: true }); }
      setTimeout(function () { location.href = 'yt-online.html'; }, 1500);
    });
    if (online.onStatus) online.onStatus(function (phase) {
      if (!window.Notify) return;
      if (phase === 'reconnecting') window.Notify.show('连接中断，正在重连…', 'warn', { sticky: true });
      else if (phase === 'connected') window.Notify.clearAll();
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    ['gameRoot', 'ytCanvas', 'myHand', 'laneBtns', 'hpNumL', 'hpNumR', 'hpFillL', 'hpFillR',
      'hpNameL', 'hpNameR', 'fieldTip', 'ytResult', 'resultTitle', 'resultDesc',
      'btnNew', 'btnAgain', 'btnLeave2', 'roomCodeTag'].forEach(function (id) { el[id] = $(id); });

    mode = (q.mode === 'online') ? 'online' : (q.mode === 'local') ? 'local' : 'ai';
    round = new window.YTRender.Round($('ytCanvas'), { flip: false });
    window.addEventListener('resize', function () { round.resize(); });
    round.start(function () { return view; });
    bindUI();

    if (mode === 'online') {
      if (!q.room) {
        if (window.Notify) window.Notify.show('缺少房间信息，返回大厅', 'error', { sticky: true });
        setTimeout(function () { location.href = 'yt-online.html'; }, 1500);
        return;
      }
      currentRoom = q.room;
      isHost = q.role === 'host';
      round.flip = (q.role === 'guest');
      if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + currentRoom; el.roomCodeTag.hidden = false; }
      var gname = 'yt';
      lobby = new window.GameLobby({
        onReady: function () { if (o) o.sendReady(); },
        onStart: function () { if (o) o.sendStart(); },
        onNotify: function () { if (o) o.sendNotify(); },
        onLeave: function () { if (o) o.sendLeave(); location.href = 'yt.html'; },
        onAddAI: function (i) { if (o) o.send({ type: 'add_ai', slot: i }); },
        onRemoveAI: function (i) { if (o) o.send({ type: 'remove_ai', slot: i }); },
        game: gname
      });
      lobby.setCapacity(2);
      lobby.show(currentRoom);
      lobby.setStatus('连接中…', 'connecting');
      if (!window.YtOnline) { if (window.Notify) window.Notify.show('联机组件加载失败，请刷新', 'error', { sticky: true }); return; }
      o = new window.YtOnline();
      o.code = currentRoom;
      if (window.BotDriver) BotDriver.attach(o, { game: 'yt', delay: function () { return 500 + Math.random() * 400; } });
      bindOnline(o);
      o.connect(q.role === 'host' ? 0 : 1).catch(function () { tip('连接失败，正在重试…', true); });
      return;
    }

    // 本地：面对面 / AI
    startLocal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
