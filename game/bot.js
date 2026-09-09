/* 联机 AI 代打驱动（所有游戏共用）
 *
 * 服务端把 AI 占用的空位记录在 isAI[slot] + botOwner[slot]（拥有者连接），
 * 每个连接从 lobby 拿到 controls[slot]（该槽位 AI 是否归我代打）。
 * 当 state 轮到某个「归我代打」的 AI 槽位时，客户端用各游戏既有 AI 函数算出着法，
 * 并带上 as:slot 发给服务端 —— 服务端按该槽位权威处理（与真人走子走同一套校验）。
 *
 * 隐藏信息类游戏（海战/骗子/UNO）：服务端会在 state.ai[slot] 补发该 AI 的私有数据
 * （火力网格/手牌），供代打决策使用；其余信息对真人连接不可见，无泄密风险。
 *
 * 用法（各游戏 app 内）：
 *   BotDriver.attach(online, { game: 'wm' });
 * 或在联机走 ws 的自定义实现里手动调用 BotDriver.deciders[game](state, ctx)。
 */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : globalThis;

  // 找到「颜色制」2 人游戲中、当前轮到、且归我代打的 AI 槽位
  // state.turn 是棋子色 1/2；slot 色 = (slot===blackPlayer)?1:2
  function aiSlotForColor(state, ctx) {
    var bp = state.blackPlayer;
    for (var s = 0; s < 2; s++) {
      if (!ctx.controls[s]) continue;
      var col = (s === bp) ? 1 : 2;
      if (col === state.turn) return s;
    }
    return -1;
  }

  // 找到「槽位制」游戏中、当前轮到、且归我代打的 AI 槽位
  function aiSlotForSeat(state, ctx) {
    var t = state.turn;
    if (t == null) return -1;
    if (ctx.controls[t]) return t;
    return -1;
  }

  function sendOf(online) {
    if (typeof online._wsSend === 'function') return online._wsSend.bind(online);
    if (typeof online.send === 'function') return online.send.bind(online);
    return function () {};
  }

  // ---------- 各游戏决策器：state + ctx -> 动作(可带 as:slot)或 null ----------
  var deciders = {
    // 五子棋
    wm: function (state, ctx) {
      var s = aiSlotForColor(state, ctx);
      if (s < 0) return null;
      var col = (s === state.blackPlayer) ? 1 : 2;
      if (!W.GomokuAI) return null;
      var mv = W.GomokuAI.nextMove(state, col);
      return mv ? { type: 'move', r: mv[0], c: mv[1], as: s } : null;
    },
    // 四子棋
    c4: function (state, ctx) {
      var s = aiSlotForColor(state, ctx);
      if (s < 0) return null;
      var col = (s === state.blackPlayer) ? 1 : 2;
      if (!W.Connect4AI) return null;
      var c = W.Connect4AI.bestMove(state, col);
      return (c != null) ? { type: 'drop', col: c, as: s } : null;
    },
    // 围棋
    go: function (state, ctx) {
      var s = aiSlotForColor(state, ctx);
      if (s < 0) return null;
      var col = (s === state.blackPlayer) ? 1 : 2;
      if (!W.GoAI) return null;
      var mv = W.GoAI.nextMove(state, col);
      if (mv) return { type: 'move', r: mv.r, c: mv.c, as: s };
      return { type: 'pass', as: s };   // 无可行点 → 停一手（两停即终局，引擎处理）
    },
    // 步步为营
    qr: function (state, ctx) {
      var s = aiSlotForSeat(state, ctx);
      if (s < 0) return null;
      if (!W.QuoridorAI) return null;
      var mv = W.QuoridorAI.bestMove(state, s, { timeBudget: 600 });
      if (!mv) return null;
      var action = { type: mv.type, as: s };
      action.r = mv.r; action.c = mv.c;
      if (mv.type === 'wall') action.dir = mv.dir;
      return action;
    },
    // 海战棋（红化视图：state.you 为我（拥有者）槽位，AI 槽位的私有数据在 state.ai[slot]）
    bs: function (state, ctx) {
      if (state.winner >= 0) return null;
      for (var s = 0; s < 2; s++) {
        if (!ctx.controls[s]) continue;
        if (!state.placed[s]) {
          if (!W.Battleship) return null;
          var tmp = W.Battleship.createState();
          W.Battleship.randomPlacement(tmp, 0);
          var layout = W.Battleship.layoutOf(tmp, 0);
          return { type: 'place', layout: layout, as: s };
        }
        if (state.turn === s) {
          if (!W.BattleshipAI) return null;
          var fire = (state.ai && state.ai[s]) ? state.ai[s] : state.tracking;
          var shot = W.BattleshipAI.nextShot({ fire: [fire, fire] }, 0);
          if (shot) return { type: 'fire', r: shot.r, c: shot.c, as: s };
        }
      }
      return null;
    },
    // 优诺 UNO（state.ai[slot] = 该 AI 手牌；state.turn = 当前槽位）
    uno: function (state, ctx) {
      if (state.winner != null && state.winner >= 0) return null;
      for (var s = 0; s < 4; s++) {
        if (!ctx.controls[s]) continue;
        if (state.turn !== s) continue;
        var hand = (state.ai && state.ai[s]) ? state.ai[s] : null;
        if (!hand) return null;
        if (!W.UnoAI) return null;
        return W.UnoAI.choose(state, s, hand);
      }
      return null;
    },
    // 骗子酒馆（state.ai[slot] = 该 AI 手牌；state.current = 当前玩家 id 字符串）
    liar: function (state, ctx) {
      if (state.phase !== 'playing') return null;
      for (var s = 0; s < 4; s++) {
        if (!ctx.controls[s]) continue;
        if (state.current !== String(s)) continue;
        var hand = (state.ai && state.ai[s]) ? state.ai[s] : null;
        if (!W.LiarAIBot) return null;
        return W.LiarAIBot.decide(state, s, hand);
      }
      return null;
    },
  };

  // ---------- 驱动主体 ----------
  // attach(online, { game }) —— 自动 hook lobby(state.controls) + state 事件
  // 依赖 online.on('lobby'/'state') 支持多回调（已在本仓库各 online.js 升级）
  function attach(online, opts) {
    var game = opts.game;
    var decider = deciders[game];
    if (!decider) return null;
    var lastSig = null;
    var controls = null;
    var sender = sendOf(online);
    var delay = (opts.delay != null) ? opts.delay : 350;

    function onLobby(d) { if (d && d.controls) controls = d.controls; }
    function onState(v) {
      if (!controls) return;                       // 尚未拿到 lobby，无法判断 AI 归属
      var sig;
      try { sig = JSON.stringify(v); } catch (e) { sig = null; }
      if (sig !== null && sig === lastSig) return; // 同局面重复下发 → 不重复决策
      lastSig = sig;
      var ctx = { controls: controls, you: online.player };
      var action = decider(v, ctx);
      if (!action) return;
      var acts = Array.isArray(action) ? action : [action];
      acts.forEach(function (a) {
        if (delay > 0) setTimeout(function () { sender(a); }, delay);
        else sender(a);
      });
    }

    online.on('lobby', onLobby);
    online.on('state', onState);
    return {
      stop: function () { controls = null; },
    };
  }

  (typeof window !== 'undefined' ? window : globalThis).BotDriver = {
    attach: attach,
    deciders: deciders,
    aiSlotForColor: aiSlotForColor,
    aiSlotForSeat: aiSlotForSeat,
  };
})();
