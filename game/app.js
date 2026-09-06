/* 交互层：读取 URL 参数开局（local / ai / online），处理鼠标操作、AI 对手、渲染循环、联机同步 */
(function () {
  'use strict';

  var Q = window.Quoridor;
  var canvas = document.getElementById('board');
  var R = new window.QRender(canvas);

  var state = null;
  var vsAI = false;
  var aiSide = 1;
  var placing = false;
  var aiThinking = false;
  var started = false;

  // 抛硬币 / 横幅
  var coinLock = false;     // 抛硬币动画期间锁输入
  var coinShown = false;    // 本局是否已播放过抛硬币（联机重开时复位，避免重复播放）
  var winTimer = null;

  // 联机模式
  var online = null;
  var onlineMode = false;
  var myPlayer = -1;
  var oppConnected = false;
  var connOk = false;
  var welcomed = false;
  var roomStarted = false;     // 联机：等待室是否已开始（false=等待室，true=对局中）
  var currentRoom = '';
  var lobby = null;
  var lastPlayers = null;   // 最近一次收到的双方在线状态，welcome 后用于补算对手在线情况
  var connBanner = false;   // 当前是否因「我方连接中断」而显示横幅

  // 悔棋 / 重开 的双向确认状态
  var reqPending = false;
  var reqKind = null;
  var incomingKind = null;
  var leftShown = false;
  var wantNew = false;     // 本端是否已点击「重开」（用于「双方都点→默认同意」）
  var resetSent = false;   // 本局「重开重置」是否已发出，防止 res_new 重复/重投递导致双重置

  var el = {};
  ['turnLabel', 'w1', 'w2', 'banner', 'btnMove', 'btnWall', 'btnUndo',
   'btnNew', 'stepCount', 'p2name', 'onlineStatus', 'roomCodeTag',
   'reqModal', 'reqText', 'reqSub', 'btnReqOk', 'btnReqNo',
   'coinModal', 'coin', 'coinTitle', 'coinResult', 'coinSub'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  function isAITurn() { return !onlineMode && vsAI && state && state.turn === aiSide; }

  /* ---------- 横幅 / 抛硬币 ---------- */

  function hideBanner() { if (winTimer) { clearTimeout(winTimer); winTimer = null; } }
  // 棋盘横幅已取消：一律走顶部通知栏。胜负(sticky)按文案判 win/lose；提醒类走 warn/error(常驻)
  function showWinBanner(text, autoClose) {
    var isWin = /胜利|获胜|你赢了|恭喜/.test(text) && !/失败/.test(text);
    window.Notify.show(text, isWin ? 'win' : 'lose', { sticky: true });
    hideBanner();
  }
  function flashBanner(text) {
    window.Notify.show(text, 'warn', { sticky: true });
    hideBanner();
  }

  // 抛硬币决定先手：first = 先手玩家(0 红 / 1 紫)
  function playCoin(first, opts) {
    opts = opts || {};
    coinLock = true;
    coinShown = true;
    el.coinModal.hidden = false;
    el.coin.classList.remove('flip', 'settled');
    el.coinTitle.textContent = '随机先手';
    el.coinResult.textContent = '';
    el.coinSub.textContent = '';
    void el.coin.offsetWidth;        // 强制重排以重启动画
    el.coin.classList.add('flip');
    setTimeout(function () {
      var firstLabel, sub;
      if (opts.ai) {
        firstLabel = first === 0 ? '🟥 你（红方）先手' : '🟪 电脑（紫方）先手';
        sub = first === 0 ? '你先手，开始！' : '电脑先手，稍候…';
      } else if (opts.mode === 'online') {
        firstLabel = first === 0 ? '🟥 红方先手' : '🟪 紫方先手';
        sub = (first === myPlayer) ? '你先手，开始！' : '对手先手';
      } else {
        firstLabel = first === 0 ? '🟥 红方先手' : '🟪 紫方先手';
        sub = first === 0 ? '玩家一先手' : '玩家二先手';
      }
      el.coinResult.textContent = firstLabel;
      el.coinSub.textContent = sub;
      el.coin.classList.add('settled');
    }, 1100);
    setTimeout(function () {
      el.coinModal.hidden = true;
      el.coin.classList.remove('flip', 'settled');
      coinLock = false;
      syncUI();
      updateHints();
      if (opts.ai && state && state.winner < 0 && state.turn === aiSide) maybeAI();
    }, 2400);
  }

  /* ---------- 局面控制 ---------- */

  // 开新局：随机先手 + 抛硬币动画，ai 为 true 时人类=玩家0、电脑=玩家1
  function beginGame(ai) {
    invalidateAI();                                       // 作废任何在途的 AI 计算结果
    vsAI = !!ai;
    state = Q.createState();
    state.turn = Math.random() < 0.5 ? 0 : 1;   // 随机先手，消除先手优势
    aiSide = 1;
    placing = false;
    aiThinking = false;
    R.anim = null;
    R.hover = null;
    winTimer && clearTimeout(winTimer);
    hideBanner();
    window.Notify.clearAll();        // 新局：清掉上一局胜负常驻通知
    el.p2name.textContent = vsAI ? '电脑' : (onlineMode ? '对手' : '玩家二');
    coinShown = false;
    syncUI();
    playCoin(state.turn, { ai: vsAI, mode: 'local' });
  }

  function startLocal() { started = true; onlineMode = false; beginGame(false); }
  function startAI()    { started = true; onlineMode = false; beginGame(true); }

  function syncUI() {
    el.w1.textContent = state.players[0].walls;
    el.w2.textContent = state.players[1].walls;
    el.stepCount.textContent = Math.ceil(state.history.length / 2);

    if (state.winner < 0 && (roomStarted || !onlineMode)) {
      if (onlineMode) {
        window.Notify.setTurn((state.turn === myPlayer ? '你' : '对手') + ' 行动');
      } else if (aiThinking) {
        window.Notify.setTurn('电脑思考中');
      } else {
        window.Notify.setTurn((state.turn === 0 ? '玩家一' : (vsAI ? '电脑' : '玩家二')) + ' 行动');
      }
    }

    el.btnMove.classList.toggle('on', !placing);
    el.btnWall.classList.toggle('on', placing);
    var wallPlayer = (onlineMode && myPlayer >= 0) ? myPlayer : state.turn;
    el.btnWall.disabled = !placing && state.players[wallPlayer].walls <= 0;
    el.btnUndo.disabled = reqPending || state.history.length === 0;
    el.btnNew.disabled = reqPending;
  }

  // 提示格：仅当轮到「本地玩家」且可操作时才显示（修复玩家2看不到提示）
  function updateHints() {
    if (!state || state.winner >= 0 || aiThinking || placing || !interactive()) R.hints = [];
    else R.hints = Q.legalMoves(state, onlineMode ? myPlayer : state.turn);
  }

  function afterAction() {
    R.hover = null;
    placing = false;
    syncUI();
    updateHints();
    if (state.winner >= 0) {
      if (vsAI) {
        showWinBanner(state.winner === 0 ? '🎉 恭喜你胜利了！' : '😶 电脑获胜，再来一局？', true);
      } else if (onlineMode) {
        showWinBanner(state.winner === myPlayer ? '🎉 你赢了！' : '对手获胜', false);
      } else {
        showWinBanner((state.winner === 0 ? '玩家一' : '玩家二') + ' 获胜', false);
      }
      return;
    }
    maybeAI();
  }

  /* ---------- AI（Web Worker 后台搜索，不阻塞主线程动画） ---------- */

  // 把 Minimax 搜索放进 Web Worker，主线程继续跑 requestAnimationFrame 渲染循环，
  // 彻底解决「电脑思考时用户走子动画被卡住」的问题。Worker 不可用时退回同步计算。
  var aiWorker = null;
  var aiReqId = 0;

  // 让任何在途的 AI 计算结果作废（开新局 / 悔棋等切换局面时调用）
  function invalidateAI() { aiReqId++; aiThinking = false; }

  function ensureAIWorker() {
    if (aiWorker) return aiWorker;
    try {
      aiWorker = new Worker('ai.worker.js?v=g10');
      aiWorker.onmessage = function (ev) {
        var msg = ev.data;
        if (!msg) return;
        if (msg.reqId !== aiReqId) return;                 // 过期结果直接丢弃
        if (msg.type === 'error') {                        // Worker 出错 → 同步兜底
          aiWorker = null;
          syncAIFallback();
          return;
        }
        if (msg.type === 'move') applyAIMove(msg.move);
      };
      aiWorker.onerror = function () {                     // 加载/运行失败 → 同步兜底
        aiWorker = null;
        syncAIFallback();
      };
    } catch (ex) {
      aiWorker = null;
    }
    return aiWorker;
  }

  // 同步兜底（仅当 Worker 不可用/出错时触发），会短暂阻塞主线程，但保证 AI 仍可行动
  function syncAIFallback() {
    setTimeout(function () {
      if (!state || state.winner >= 0 || state.turn !== aiSide) return;
      if (typeof QuoridorAI === 'undefined') return;
      var mv = QuoridorAI.bestMove(state, aiSide, { timeBudget: 1000, maxDepth: 7 });
      applyAIMove(mv);
    }, 30);
  }

  // 将 Worker 算出的着法应用到盘面（含动画与收尾），不再递归触发 maybeAI
  function applyAIMove(mv) {
    aiThinking = false;
    if (!mv || !state || state.winner >= 0 || state.turn !== aiSide) {
      syncUI(); updateHints(); return;
    }
    if (mv.type === 'wall') {
      var ok = Q.placeWall(state, aiSide, mv.r, mv.c, mv.dir);
      if (!ok) {                                          // 墙非法 → 退而走一步
        var ms = Q.legalMoves(state, aiSide);
        if (ms.length) ok = Q.move(state, aiSide, ms[0].r, ms[0].c);
      }
    } else {
      var from = { r: state.players[aiSide].r, c: state.players[aiSide].c };
      Q.move(state, aiSide, mv.r, mv.c);
      R.startAnim(aiSide, from, { r: mv.r, c: mv.c });
    }
    R.hover = null;
    placing = false;
    syncUI();
    updateHints();
    if (state.winner >= 0) {
      showWinBanner('😶 电脑获胜，再来一局？', true);
    }
  }

  function maybeAI() {
    if (onlineMode) return;
    if (!vsAI || !state || state.winner >= 0 || state.turn !== aiSide) return;
    aiThinking = true;                                    // 立即置位，主线程不被阻塞
    syncUI();
    updateHints();
    var myReq = ++aiReqId;                                // 标记本次请求，旧结果会因 reqId 不匹配被丢弃
    var worker = ensureAIWorker();
    if (worker) {
      try {
        worker.postMessage({
          type: 'think',
          reqId: myReq,
          state: state,
          aiSide: aiSide,
          opts: { timeBudget: 1000, maxDepth: 7 }
        });
        return;                                           // 立刻返回，主线程继续渲染动画
      } catch (ex) { /* 落到同步兜底 */ }
    }
    syncAIFallback();
  }

  /* ---------- 输入 ---------- */

  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function interactive() {
    if (!state || state.winner >= 0 || aiThinking || coinLock) return false;
    if (onlineMode) return connOk && !reqPending && state.turn === myPlayer;
    return !isAITurn();
  }

  canvas.addEventListener('mousemove', function (e) {
    if (!interactive()) { R.hover = null; canvas.style.cursor = 'default'; return; }
    var p = pointerPos(e);
    if (placing) {
      var w = R.hitWall(p.x, p.y);
      if (w) {
        w.type = 'wall';
        w.valid = state.players[state.turn].walls > 0 && Q.canPlaceWall(state, w.r, w.c, w.dir);
        R.hover = w;
        canvas.style.cursor = w.valid ? 'pointer' : 'not-allowed';
      } else {
        R.hover = null;
        canvas.style.cursor = 'default';
      }
    } else {
      var cell = R.hitCell(p.x, p.y);
      var can = false;
      if (cell) {
        for (var i = 0; i < R.hints.length; i++) {
          if (R.hints[i].r === cell.r && R.hints[i].c === cell.c) { can = true; break; }
        }
      }
      R.hover = can ? { type: 'cell', r: cell.r, c: cell.c } : null;
      canvas.style.cursor = can ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('mouseleave', function () { R.hover = null; });

  canvas.addEventListener('click', function (e) {
    if (!interactive()) return;
    var p = pointerPos(e);
    var who = onlineMode ? myPlayer : state.turn;

    if (placing) {
      var w = R.hitWall(p.x, p.y);
      if (!w || !Q.canPlaceWall(state, who, w.r, w.c, w.dir)) return;
      if (onlineMode) {
        Q.placeWall(state, who, w.r, w.c, w.dir);
        afterAction();
        online.sendWall(w.r, w.c, w.dir);
      } else if (Q.placeWall(state, who, w.r, w.c, w.dir)) {
        afterAction();
      }
      return;
    }

    var cell = R.hitCell(p.x, p.y);
    if (!cell) return;
    var legal = Q.legalMoves(state, who);
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].r === cell.r && legal[i].c === cell.c) {
        var from = { r: state.players[who].r, c: state.players[who].c };
        Q.move(state, who, cell.r, cell.c);
        R.startAnim(who, from, { r: cell.r, c: cell.c });
        if (onlineMode) { afterAction(); online.sendMove(cell.r, cell.c); }
        else afterAction();
        return;
      }
    }
  });

  /* ---------- 按钮 ---------- */

  function setPlacing(v) {
    if (!interactive()) return;
    if (v && state.players[state.turn].walls <= 0) return;
    placing = v;
    R.hover = null;
    syncUI();
    updateHints();
  }

  el.btnMove.addEventListener('click', function () { setPlacing(false); });
  el.btnWall.addEventListener('click', function () { setPlacing(!placing); });

  el.btnUndo.addEventListener('click', function () {
    if (onlineMode) { requestUndo(); return; }
    if (aiThinking || !state.history.length) return;
    Q.undo(state);
    if (vsAI && state.history.length) Q.undo(state);
    hideBanner();
    placing = false; R.anim = null; R.hover = null; aiThinking = false;
    syncUI(); updateHints();
  });

  el.btnNew.addEventListener('click', function () {
    if (onlineMode) { requestNew(); return; }
    beginGame(vsAI);
  });

  function doUndoCore() {
    Q.undo(state);
    hideBanner();
    placing = false; R.anim = null; R.hover = null; aiThinking = false;
    syncUI(); updateHints();
  }

  /* ---------- 联机：悔棋 / 重开 的双向确认 ---------- */

  function showReqModal(text, sub) {
    if (!el.reqModal) return;
    el.reqText.textContent = text;
    el.reqSub.textContent = sub || '';
    el.reqModal.hidden = false;
  }
  function hideReqModal() { if (el.reqModal) el.reqModal.hidden = true; }

  function requestUndo() {
    if (reqPending || !state || state.history.length === 0 || state.winner >= 0) return;
    reqPending = true; reqKind = 'undo'; incomingKind = null;
    online.sendRelay('req_undo');
    showOnlineStatus('已发送悔棋请求，等待对方确认…', 'connecting');
    syncUI();
  }
  function respondUndo(ok) {
    incomingKind = null; hideReqModal();
    online.sendRelay('res_undo', ok);
    reqPending = false;
    if (ok) { doUndoCore(); showOnlineStatus('已同意悔棋', 'connected'); }
    else { showOnlineStatus('已拒绝对方悔棋', 'disconnected'); }
    syncUI();
  }

  function requestNew() {
    if (reqPending || !state) return;
    reqPending = true; reqKind = 'new'; incomingKind = null; wantNew = true;
    online.sendRelay('req_new');
    showOnlineStatus('已发送重开请求，等待对方确认…', 'connecting');
    syncUI();
  }
  function respondNew(ok) {
    incomingKind = null; hideReqModal();
    online.sendRelay('res_new', ok);
    reqPending = false; wantNew = false;
    if (ok) { coinShown = false; showOnlineStatus('已同意重开，等待重置…', 'connecting'); }
    else { showOnlineStatus('已拒绝对方重开', 'disconnected'); }
    syncUI();
  }

  if (el.btnReqOk) el.btnReqOk.addEventListener('click', function () {
    if (incomingKind === 'undo') respondUndo(true);
    else if (incomingKind === 'new') respondNew(true);
  });
  if (el.btnReqNo) el.btnReqNo.addEventListener('click', function () {
    if (incomingKind === 'undo') respondUndo(false);
    else if (incomingKind === 'new') respondNew(false);
  });

  /* ---------- 联机模式（互联网对战） ---------- */

  function showOnlineStatus(msg, cls) {
    // 全局通知栏：颜色按严重程度分级（info 青 / success 绿 / warn 橙 / error 红）
    var type = cls === 'connected' ? 'success'
      : cls === 'reconnecting' ? 'warn'
      : cls === 'disconnected' ? 'error'
      : 'info';
    if (type === 'success') window.Notify.clearSticky();   // 连接恢复：清除待回滚的断开/重连常驻通知
    window.Notify.show(msg, type, (type === 'warn' || type === 'error') ? { sticky: true } : undefined);
  }

  /* 统一处理「对手在线状态」：在线/离线/重连 三态切换。
     ps 为 [是否玩家0在线, 是否玩家1在线]。myPlayer 在 welcome 后才有效；
     若早于 welcome 收到 players，先存 lastPlayers，待 welcome 时补算，避免竞态。 */
  function applyOpponent(ps) {
    lastPlayers = ps;
    if (myPlayer < 0) return;
    var now = !!(ps[1 - myPlayer]);
    var was = oppConnected;
    if (now && !was) {
      // 对手（重新）上线
      if (leftShown) { leftShown = false; hideBanner(); }
      showOnlineStatus(myPlayer === 0 ? '对方已进入房间，开始游戏' : '双方已就位，开始游戏', 'connected');
    } else if (!now && was) {
      // 对手掉线：锁住确认弹窗，提示等待重连（仍允许本端在自己回合继续走子）
      reqPending = false; reqKind = null; incomingKind = null; hideReqModal();
      leftShown = true;
      showOnlineStatus('对手已离开游戏，等待其重连…', 'reconnecting');
      flashBanner('对手已离开游戏，等待重连…');
    } else if (!now && !was) {
      // 一直没对手：等待加入 / 等待房主创建
      showOnlineStatus(myPlayer === 0 ? '等待对手加入…（把房间码发给朋友）' : '等待对方创建房间…', 'connecting');
    }
    oppConnected = now;
  }

  function applyRemote(s) {
    state = s;
    R.hover = null;
    placing = false;
    syncUI();
    updateHints();
    R.draw(state);
    if (state.winner >= 0) {
      showWinBanner(state.winner === myPlayer ? '🎉 你赢了！' : '对手获胜', false);
    }
  }

  function bindOnlineEvents(o) {
    o.on('welcome', function (p) {
      var first = !welcomed;
      welcomed = true;
      myPlayer = p;
      vsAI = false;                                  // 联机不是人机，否则会误判玩家2为AI而吞掉提示
      R.flip = (p === 1);
      connOk = true;
      if (!roomStarted && first) {
        if (lobby) { lobby.show(currentRoom); lobby.setStatus('已连接，等待双方准备', 'connected'); }
        showOnlineStatus('已进入房间，等待准备开始', 'connected');
      } else if (roomStarted) {
        showOnlineStatus('已重新连接，继续对战', 'connected');
      }
      if (lastPlayers) applyOpponent(lastPlayers);   // 补算对手在线状态，消除 myPlayer<0 竞态
      syncUI();
      updateHints();
    });
    o.on('lobby', function (d) {
      myPlayer = d.you; connOk = true;
      roomStarted = !!d.started;
      if (lobby) {
        if (d.started) lobby.hide();
        else { lobby.show(currentRoom); lobby.render(d); }
      }
    });
    o.on('started', function () { roomStarted = true; if (lobby) lobby.hide(); });
    o.on('dissolve', function () {
      roomStarted = false;
      if (online) online._intentionalClose = true;
      if (lobby) lobby.hide();
      showOnlineStatus('房间已解散（有玩家离开），即将返回大厅…', 'disconnected');
      setTimeout(function () { location.href = 'online.html'; }, 1800);
    });
    o.on('state', function (s) {
      roomStarted = true;
      if (lobby) lobby.hide();
      applyRemote(s);
      if (s.history.length === 0) { wantNew = false; resetSent = false; window.Notify.clearAll(); }   // 新一局：清重开标记与上一局胜负常驻
      // 开局抛硬币：收到第一份「空棋盘」权威局面时播放一次
      if (!coinShown) {
        if (s.history.length === 0) { playCoin(s.turn, { mode: 'online' }); }
        else { coinShown = true; }   // 中途加入已开局的对局，跳过抛硬币
      }
    });
    o.on('players', function (ps) { applyOpponent(ps); });
    o.on('notify', function () { window.Notify.show('🔔 房主提醒你准备', 'warn'); });
    o.on('req_undo', function () {
      if (!state || state.winner >= 0 || state.history.length === 0) { online.sendRelay('res_undo', false); return; }
      reqPending = true; incomingKind = 'undo';
      showReqModal('对方请求悔棋', '同意后撤回上一步');
      syncUI();
    });
    o.on('res_undo', function (ok) {
      // 悔棋的权威回退由服务端完成（Q.undo + 广播 state），客户端不再本地回退，
      // 否则请求方会先收到 state 广播（已退一步）再收到 res_undo（又退一步）→ 双重回退、双方不同步。
      // 这里只清除输入锁；真正的局面变更由下方 state 广播的 applyRemote 整体替换落地。
      reqPending = false;
      if (ok) { showOnlineStatus('悔棋成功', 'connected'); }
      else { showOnlineStatus('对方拒绝了悔棋', 'disconnected'); }
      syncUI();
    });
    o.on('req_new', function () {
      if (!state) { online.sendRelay('res_new', false); return; }
      // 双方都想重开 → 默认同意，不再弹确认窗（也不用等对方点）。
      // 约定：玩家编号较小的一方回 res_new，较大的一方静默等待其回包后再触发重置，
      // 避免两端都回 res_new 造成服务端连续两次重置、先手动画显示不一致。
      if (wantNew) {
        if (myPlayer === 0) {
          incomingKind = null; hideReqModal();
          online.sendRelay('res_new', true);
          reqPending = false; wantNew = false;
          showOnlineStatus('双方都想重开，已自动同意，重置中…', 'connecting');
        } else {
          incomingKind = null; hideReqModal();
          reqPending = false;
          showOnlineStatus('对方也想重开，正在重置…', 'connecting');
        }
        syncUI();
        return;
      }
      reqPending = true; incomingKind = 'new';
      showReqModal('对方请求重开一局', '同意后棋局将重置');
      syncUI();
    });
    o.on('res_new', function (ok) {
      reqPending = false; wantNew = false;
      if (ok) {
        coinShown = false;                          // 重开：下一帧收到新棋盘时再抛一次硬币
        if (!resetSent) { resetSent = true; online.sendReset(); }  // 防止 res_new 重投递导致双重置
        showOnlineStatus('已同意重开，重置中…', 'connecting');
      } else {
        showOnlineStatus('对方拒绝了重开', 'disconnected');
      }
      syncUI();
    });
    o.on('status', function (s) {
      if (s.state === 'connecting') {
        connOk = false;
        if (connBanner) { connBanner = false; if (!(state && state.winner >= 0)) hideBanner(); }
        showOnlineStatus('连接中…', 'connecting');
      }
      else if (s.state === 'connected') {
        connOk = true;
        if (myPlayer < 0) showOnlineStatus('已连接', 'connected');
        if (connBanner) { connBanner = false; if (!(state && state.winner >= 0)) hideBanner(); }
      }
      else if (s.state === 'reconnecting') {
        connOk = false;
        connBanner = true;
        showOnlineStatus(s.detail || '连接中断，重连中…', 'reconnecting');
        if (state && state.winner < 0) flashBanner('连接中断，正在重连…');
      }
      else if (s.state === 'disconnected') {
        connOk = false;
        showOnlineStatus(s.detail || '连接已断开', 'disconnected');
      }
    });
    o.on('error', function (msg) { showOnlineStatus('错误：' + msg, 'disconnected'); });
    o.on('close', function () { connOk = false; showOnlineStatus('连接已断开', 'disconnected'); });
  }

  function startOnline(room, role) {
    onlineMode = true;
    vsAI = false;
    myPlayer = role === 'host' ? 0 : 1;
    R.flip = (myPlayer === 1);
    connOk = false;
    welcomed = false;
    reqPending = false; reqKind = null; incomingKind = null; leftShown = false; wantNew = false; resetSent = false;
    coinShown = false; coinLock = false;
    state = Q.createState();
    el.p2name.textContent = '对手';
    started = true;
    roomStarted = false; currentRoom = room;
    if (el.roomCodeTag) { el.roomCodeTag.textContent = '房间 ' + room; el.roomCodeTag.hidden = false; }
    syncUI();
    updateHints();

    online = new window.QuoridorOnline();
    online.code = room;
    lobby = new window.GameLobby({
      onReady: function () { if (online) online.sendReady(); },
      onStart: function () { if (online) online.sendStart(); },
        onNotify: function () { if (online) online.sendNotify(); window.Notify.show('已提醒对方准备', 'info'); },
      onLeave: function () { if (online) online.sendLeave(); location.href = 'online.html'; }
    });
    lobby.show(room);
    lobby.setStatus('连接中…', 'connecting');
    bindOnlineEvents(online);
    online.connect(role === 'host' ? 0 : 1);
  }

  document.addEventListener('keydown', function (e) {
    if (!started) return;
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (onlineMode) {
      if (k === 'u') el.btnUndo.click();
      else if (k === 'n') el.btnNew.click();
      return;
    }
    if (k === 'w') setPlacing(!placing);
    else if (k === 'u') el.btnUndo.click();
    else if (k === 'n') beginGame(vsAI);
  });

  /* ---------- 循环 ---------- */

  function loop() {
    if (state) R.draw(state);
    requestAnimationFrame(loop);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { R.resize(); }, 80);
  });

  R.resize();
  loop();

  /* ---------- 开局引导：根据 URL 参数进入对应模式 ---------- */

  function boot() {
    var params = new URLSearchParams(location.search);
    var mode = params.get('mode');
    if (mode === 'ai') {
      startAI();
    } else if (mode === 'local') {
      startLocal();
    } else if (mode === 'online') {
      var room = (params.get('room') || '').trim().toUpperCase();
      var role = params.get('role') || 'guest';
      if (!room) {
        showOnlineStatus('缺少房间码，请从「互联网对战」页进入');
        return;
      }
      startOnline(room, role);
    } else {
      location.href = 'quoridor.html';
    }
  }

  boot();

  /* 调试 / 扩展出口 */
  window.QuoridorGame = {
    get state() { return state; },
    get vsAI() { return vsAI; },
    get myPlayer() { return myPlayer; },
    get onlineMode() { return onlineMode; },
    get reqPending() { return reqPending; },
    get wantNew() { return wantNew; },
    get coinLock() { return coinLock; },
    renderer: R,
    engine: Q,
    online: online,
    beginGame: beginGame
  };
})();
