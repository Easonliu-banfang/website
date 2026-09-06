/* 海战棋（Battleship）规则引擎 —— 经典版，纯逻辑无 DOM，可单独测试。
 *
 * 棋盘 10x10，舰队（经典）：
 *   航母 5 / 战列舰 4 / 巡洋舰 3 / 潜艇 3 / 驱逐舰 2
 *
 * 状态结构（同时用于本地/人机/联机，联机时服务端持有完整 state 并下发 redact 视图）：
 *   ocean[p] : 10x10，每格 { ship: -1 或船索引(0..4), hit: bool } —— 玩家 p 自己的舰队与挨打情况
 *   fire[p]  : 10x10，0 未知 / 1 未命中 / 2 命中 / 3 击沉 —— 玩家 p 朝对手(1-p)开火的结果
 *   turn / winner / placed[2] / ships[2] / history
 */
(function (global) {
  'use strict';

  var SIZE = 10;
  var FLEET = [
    { name: '航母', size: 5 },
    { name: '战列舰', size: 4 },
    { name: '巡洋舰', size: 3 },
    { name: '潜艇', size: 3 },
    { name: '驱逐舰', size: 2 }
  ];

  function emptyOcean() {
    var g = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push({ ship: -1, hit: false });
      g.push(row);
    }
    return g;
  }

  function emptyFire() {
    var g = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(0);
      g.push(row);
    }
    return g;
  }

  function shipList() {
    return FLEET.map(function (f, i) {
      return { idx: i, name: f.name, size: f.size, cells: [], sunk: false };
    });
  }

  function createState() {
    return {
      size: SIZE,
      ocean: [emptyOcean(), emptyOcean()],
      fire: [emptyFire(), emptyFire()],
      turn: 0,
      winner: -1,
      placed: [false, false],
      ships: [shipList(), shipList()],
      history: []   // 每步：{ by, r, c, result: 'miss'|'hit'|'sunk', ship }
    };
  }

  function randomPlacement(state, p) {
    clearPlacement(state, p);
    for (var si = 0; si < FLEET.length; si++) {
      var ok = false, tries = 0;
      while (!ok && tries < 800) {
        var horizontal = Math.random() < 0.5;
        var r = Math.floor(Math.random() * SIZE);
        var c = Math.floor(Math.random() * SIZE);
        ok = placeShip(state, p, si, r, c, horizontal);
        tries++;
      }
    }
    state.placed[p] = true;
  }

  function clearPlacement(state, p) {
    state.ocean[p] = emptyOcean();
    state.ships[p] = shipList();
  }

  // 校验：在 (r,c) 起、水平/垂直放第 shipIdx 艘船是否合法（不越界、不重叠）
  function canPlaceShip(state, p, shipIdx, r, c, horizontal) {
    var size = FLEET[shipIdx].size;
    var cells = [];
    for (var i = 0; i < size; i++) {
      var rr = horizontal ? r : r + i;
      var cc = horizontal ? c + i : c;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return null;
      if (state.ocean[p][rr][cc].ship !== -1) return null;
      cells.push([rr, cc]);
    }
    return cells;
  }

  function placeShip(state, p, shipIdx, r, c, horizontal) {
    var cells = canPlaceShip(state, p, shipIdx, r, c, horizontal);
    if (!cells) return false;
    var prev = state.ships[p][shipIdx].cells;
    for (var i = 0; i < prev.length; i++) {
      state.ocean[p][prev[i][0]][prev[i][1]].ship = -1;
    }
    state.ships[p][shipIdx].cells = cells;
    state.ships[p][shipIdx].sunk = false;
    for (var j = 0; j < cells.length; j++) {
      state.ocean[p][cells[j][0]][cells[j][1]].ship = shipIdx;
    }
    return true;
  }

  function allPlaced(state, p) {
    return state.ships[p].every(function (s) { return s.cells.length === s.size; });
  }

  // 玩家 p 朝对手开火。返回 'miss' | 'hit' | 'sunk' | false（非法）
  function fire(state, p, r, c) {
    if (state.winner >= 0) return false;
    if (!state.placed[0] || !state.placed[1]) return false;
    if (state.turn !== p) return false;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
    var o = 1 - p;
    if (state.fire[p][r][c] !== 0) return false;   // 该格已打过
    var shipIdx = state.ocean[o][r][c].ship;
    var result;
    if (shipIdx === -1) {
      state.fire[p][r][c] = 1;   // 未命中
      result = 'miss';
    } else {
      state.fire[p][r][c] = 2;   // 命中
      state.ocean[o][r][c].hit = true;
      result = 'hit';
      var ship = state.ships[o][shipIdx];
      var sunk = ship.cells.every(function (cell) {
        return state.ocean[o][cell[0]][cell[1]].hit;
      });
      if (sunk) {
        ship.sunk = true;
        result = 'sunk';
        for (var k = 0; k < ship.cells.length; k++) {
          state.fire[p][ship.cells[k][0]][ship.cells[k][1]] = 3;  // 击沉：揭示船形
        }
      }
    }
    state.history.push({ by: p, r: r, c: c, result: result, ship: shipIdx });
    var allSunk = state.ships[o].every(function (s) { return s.sunk; });
    if (allSunk) {
      state.winner = p;
    } else {
      state.turn = o;
    }
    return result;
  }

  function reset(state) {
    var s = createState();
    s.turn = Math.random() < 0.5 ? 0 : 1;   // 随机先手，消除先手优势
    return s;
  }

  // 联机：服务端给某玩家下发「红化视图」，绝不暴露对手船位（雾战）
  function redact(state, p) {
    return {
      you: p,
      ocean: state.ocean[p],          // 自己的船 + 挨打情况（只发给本人）
      tracking: state.fire[p],        // 你朝对手开火的结果（0/1/2/3）
      turn: state.turn,
      winner: state.winner,
      placed: state.placed,
      fleet: state.ships.map(function (list) {
        return list.map(function (s) { return { name: s.name, size: s.size, sunk: s.sunk }; });
      }),
      history: state.history
    };
  }

  // 校验客户端上传的布阵 layout（5 艘船的 cells），防明显作弊；合法则写入 ocean
  function applyLayout(state, p, layout) {
    if (!Array.isArray(layout) || layout.length !== FLEET.length) return false;
    clearPlacement(state, p);
    var seen = {};
    for (var si = 0; si < FLEET.length; si++) {
      var cells = layout[si];
      if (!Array.isArray(cells) || cells.length !== FLEET[si].size) return false;
      for (var i = 0; i < cells.length; i++) {
        var rr = cells[i][0], cc = cells[i][1];
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return false;
        var key = rr + ',' + cc;
        if (seen[key]) return false;                 // 重叠
        seen[key] = 1;
        state.ocean[p][rr][cc].ship = si;
        state.ships[p][si].cells.push([rr, cc]);
      }
    }
    state.placed[p] = true;
    return true;
  }

  function layoutOf(state, p) {
    return state.ships[p].map(function (s) { return s.cells.slice(); });
  }

  global.Battleship = {
    SIZE: SIZE,
    FLEET: FLEET,
    createState: createState,
    randomPlacement: randomPlacement,
    clearPlacement: clearPlacement,
    canPlaceShip: canPlaceShip,
    placeShip: placeShip,
    allPlaced: allPlaced,
    fire: fire,
    reset: reset,
    redact: redact,
    applyLayout: applyLayout,
    layoutOf: layoutOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
