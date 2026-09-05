/* 交互层：模式切换、鼠标操作、AI 对手、渲染循环 */
(function () {
  'use strict';

  var Q = window.Quoridor;
  var canvas = document.getElementById('board');
  var R = new window.QRender(canvas);

  var state = null;
  var vsAI = true;
  var aiSide = 1;
  var placing = false;
  var aiThinking = false;

  var el = {};
  ['turnLabel', 'w1', 'w2', 'banner', 'btnMove', 'btnWall', 'btnUndo',
   'btnNew', 'btnAI', 'btnPvP', 'stepCount', 'p2name'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  function isAITurn() { return vsAI && state && state.turn === aiSide; }

  /* ---------- 局面控制 ---------- */

  function newGame(ai) {
    vsAI = !!ai;
    state = Q.createState();
    placing = false;
    aiThinking = false;
    R.anim = null;
    R.hover = null;
    el.banner.classList.remove('show');
    el.btnAI.classList.toggle('on', vsAI);
    el.btnPvP.classList.toggle('on', !vsAI);
    el.p2name.textContent = vsAI ? '电脑' : '玩家二';
    syncUI();
    maybeAI();
  }

  function syncUI() {
    el.w1.textContent = state.players[0].walls;
    el.w2.textContent = state.players[1].walls;
    el.stepCount.textContent = Math.ceil(state.history.length / 2);

    if (state.winner >= 0) {
      el.turnLabel.textContent = (state.winner === 0 ? '玩家一' : '玩家二') + ' 获胜';
    } else if (aiThinking) {
      el.turnLabel.textContent = '电脑思考中';
    } else {
      el.turnLabel.textContent = (state.turn === 0 ? '玩家一' : (vsAI ? '电脑' : '玩家二')) + ' 行动';
    }
    el.turnLabel.className = 'turn-val p' + (state.winner >= 0 ? state.winner : state.turn);

    el.btnMove.classList.toggle('on', !placing);
    el.btnWall.classList.toggle('on', placing);
    el.btnWall.disabled = !placing && state.players[state.turn].walls <= 0;
    el.btnUndo.disabled = state.history.length === 0;
  }

  function updateHints() {
    if (!state || state.winner >= 0 || aiThinking || isAITurn() || placing) R.hints = [];
    else R.hints = Q.legalMoves(state, state.turn);
  }

  function afterAction() {
    R.hover = null;
    placing = false;
    syncUI();
    updateHints();
    if (state.winner >= 0) {
      el.banner.textContent = (state.winner === 0 ? '玩家一' : (vsAI ? '电脑' : '玩家二')) + ' 抵达对岸';
      el.banner.classList.add('show');
      return;
    }
    maybeAI();
  }

  /* ---------- AI ---------- */

  /* 在对手最短路径的首段上找一面能放的墙 */
  function aiBlockCandidate(s, p) {
    var foe = 1 - p;
    var path = Q.shortestPath(s, foe);
    if (!path || !path.length) return null;
    var f = s.players[foe], n = path[0];
    var dr = n.r - f.r, dc = n.c - f.c;
    var cand = [];
    if (dr === -1)      { cand.push([f.r - 1, f.c, 'H'], [f.r - 1, f.c - 1, 'H']); }
    else if (dr === 1)  { cand.push([f.r, f.c, 'H'],     [f.r, f.c - 1, 'H']); }
    else if (dc === -1) { cand.push([f.r, f.c - 1, 'V'], [f.r - 1, f.c - 1, 'V']); }
    else if (dc === 1)  { cand.push([f.r, f.c, 'V'],     [f.r - 1, f.c, 'V']); }
    for (var i = 0; i < cand.length; i++) {
      if (Q.canPlaceWall(s, cand[i][0], cand[i][1], cand[i][2])) {
        return { r: cand[i][0], c: cand[i][1], dir: cand[i][2] };
      }
    }
    return null;
  }

  function aiTurn() {
    var p = state.turn;
    var mine = Q.shortestPath(state, p);
    if (!mine || !mine.length) return;
    var foes = Q.shortestPath(state, 1 - p);
    // 对手不比自己慢，就先拦一手
    if (state.players[p].walls > 0 && foes && foes.length <= mine.length + 1) {
      var w = aiBlockCandidate(state, p);
      if (w) { Q.placeWall(state, p, w.r, w.c, w.dir); return; }
    }
    Q.move(state, p, mine[0].r, mine[0].c);
  }

  function maybeAI() {
    if (!vsAI || !state || state.winner >= 0 || state.turn !== aiSide) return;
    aiThinking = true;
    syncUI();
    updateHints();
    setTimeout(function () {
      if (!state || state.winner >= 0) return;
      aiTurn();
      aiThinking = false;
      syncUI();
      updateHints();
      if (state.winner >= 0) {
        el.banner.textContent = '电脑 抵达对岸';
        el.banner.classList.add('show');
      }
    }, 400);
  }

  /* ---------- 输入 ---------- */

  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function interactive() {
    return state && state.winner < 0 && !aiThinking && !isAITurn();
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

  canvas.addEventListener('mouseleave', function () {
    R.hover = null;
  });

  canvas.addEventListener('click', function (e) {
    if (!interactive()) return;
    var p = pointerPos(e);
    var who = state.turn;

    if (placing) {
      var w = R.hitWall(p.x, p.y);
      if (w && Q.placeWall(state, who, w.r, w.c, w.dir)) afterAction();
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
        afterAction();
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
  el.btnAI.addEventListener('click', function () { newGame(true); });
  el.btnPvP.addEventListener('click', function () { newGame(false); });
  el.btnNew.addEventListener('click', function () { newGame(vsAI); });

  el.btnUndo.addEventListener('click', function () {
    if (aiThinking || !state.history.length) return;
    Q.undo(state);
    if (vsAI && state.history.length) Q.undo(state);   // 连电脑那步一起退
    el.banner.classList.remove('show');
    placing = false;
    R.anim = null;
    R.hover = null;
    aiThinking = false;
    syncUI();
    updateHints();
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (k === 'w') setPlacing(!placing);
    else if (k === 'u') el.btnUndo.click();
    else if (k === 'n') newGame(vsAI);
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
  newGame(true);
  loop();

  /* 调试 / 扩展出口：控制台可查看局面，联机层也挂在这里 */
  window.QuoridorGame = {
    get state() { return state; },
    get vsAI() { return vsAI; },
    renderer: R,
    engine: Q,
    newGame: newGame,
    cellXY: function (r, c) {
      return { x: R.ox + c * R.pitch + R.cell / 2, y: R.oy + r * R.pitch + R.cell / 2 };
    },
    wallXY: function (r, c, dir) {
      return dir === 'H'
        ? { x: R.ox + c * R.pitch + (2 * R.cell + R.gap) / 2, y: R.oy + r * R.pitch + R.cell + R.gap / 2 }
        : { x: R.ox + c * R.pitch + R.cell + R.gap / 2, y: R.oy + r * R.pitch + (2 * R.cell + R.gap) / 2 };
    }
  };
})();
