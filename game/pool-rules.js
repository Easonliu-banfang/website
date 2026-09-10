/* 八球台球 —— 官方规则模块（WPA 8-Ball 主要条款，纯逻辑可 node 测试）
 *
 * 覆盖规则：
 *   开球：合法开球 = 有球入袋 或 ≥4 颗目标球碰库；白球落袋=犯规（对方头区自由球）；
 *         开球进黑八 → 重新摆球由原开球方再开；开球进球则开球方继续（桌面保持开放、不分组）。
 *   分组：开球后桌面始终开放；之后任意一杆，若只进一组球 → 该组归击球方（另一组归对方）；
 *         若同一杆进两色球 → 由击球方选择（UI 弹窗）。开球进球不分组。
 *   犯规（任一即犯规，对方全场自由球）：白球落袋；未击中任何球；先击中非本组球（已分组时）；
 *         击球后无球入袋且（白球或目标球）均未碰库；先击中黑八（己组未清、且黑八非目标时）。
 *   黑八：开球进黑八 → 重摆重开；己组未清完进黑八 → 判负；打黑八那杆犯规（白球落袋等）→ 判负；
 *         清组后合法打落黑八 → 获胜。打黑八那杆必须先碰黑八。
 *   自由球：一般犯规全场可放；开球犯规（白球落袋/非法开球）放头线后。
 */
(function (global) {
  'use strict';

  function groupOf(type) {
    if (type >= 1 && type <= 7) return 'solid';
    if (type >= 9 && type <= 15) return 'stripe';
    return null;        // 0 白球、8 黑八
  }

  function groupName(g) { return g === 'solid' ? '全色球' : (g === 'stripe' ? '花色球' : '—'); }

  function createMatch(seed) {
    return {
      turn: 0,
      isBreak: true,
      groups: [null, null],          // 'solid' | 'stripe'
      winner: null,
      loser: null,
      hand: null,                    // {kind:'anywhere'|'behindHead', forPlayer}
      needsChoose: null,             // {forPlayer} 开放桌同杆进两色 → 等玩家选
      note: null,
      lastShot: null,
      seed: seed || (Math.random() * 1e9) | 0,
    };
  }

  /* 当前击球方可合法作为首碰目标的球类型列表（依据分组与桌上有球） */
  function legalTargets(match, world) {
    var g = match.groups[match.turn];
    var onTable = {};
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (b.dead || b.type === 0) continue;
      onTable[b.type] = true;
    }
    if (!g) {
      // 开放桌：任意非黑八在桌球
      var arr = [];
      for (var t = 1; t <= 15; t++) if (t !== 8 && onTable[t]) arr.push(t);
      return arr;
    }
    // 已分组
    var own = [];
    for (t = 1; t <= 15; t++) if (groupOf(t) === g && onTable[t]) own.push(t);
    if (own.length === 0) return [8];       // 清组：只剩黑八
    return own;
  }

  function ownBallsOnTable(match, world, player) {
    var g = match.groups[player];
    if (!g) return { count: 0, types: [] };
    var list = [];
    for (var i = 0; i < world.balls.length; i++) {
      var b = world.balls[i];
      if (b.dead || b.type === 0) continue;
      if (groupOf(b.type) === g) list.push(b.type);
    }
    return { count: list.length, types: list };
  }

  /* 分析一杆：从 world 事件还原 shot 信息（击球前需 world.cueFirstContactT=null、railEvents=[]） */
  function analyzeShot(world, shotStartT) {
    var shot = {
      pocketed: [],          // 本杆进袋球类型（按进袋时间序）
      cuePocketed: false,
      firstContactType: null,
      railAfter: false,      // 白球首次碰球后，是否有任意球碰库
      breakRails: 0,         // 开球：不同目标球碰库的颗数（去重）
    };
    for (var i = 0; i < world.pocketed.length; i++) {
      var p = world.pocketed[i];
      if (p.t < shotStartT - 1e-9) continue;
      shot.pocketed.push(p.type);
      if (p.type === 0) shot.cuePocketed = true;
    }
    shot.firstContactType = world.cueFirstContactType;
    if (world.railEvents) {
      var railSeen = {};
      var firstT = world.cueFirstContactT;
      for (i = 0; i < world.railEvents.length; i++) {
        var ev = world.railEvents[i];
        if (ev.t < shotStartT - 1e-9) continue;
        if (firstT !== null && ev.t >= firstT) shot.railAfter = true;
        if (ev.type !== 0) railSeen[ev.type] = true;   // 目标球碰库
      }
      var n = 0; for (var k in railSeen) n++;
      shot.breakRails = n;
    }
    return shot;
  }

  /* 结算一杆，推进 match 状态。返回描述对象供 UI 展示 */
  function resolveShot(match, world, shot) {
    var shooter = match.turn;
    var opp = 1 - shooter;
    var res = { foul: false, reason: null, win: null, loss: null, reRack: false,
                hand: null, chooseGroup: false, note: null, turn: null, isBreak: false };
    var note = null;

    if (match.isBreak) {
      // ---- 开球 ----
      if (shot.pocketed.indexOf(8) >= 0) {
        res.reRack = true; res.turn = shooter; res.isBreak = true;
        res.note = '开球打进黑八：重新摆球，由 ' + who(shooter, match) + ' 再次开球';
        match.isBreak = true;
        return res;
      }
      var legal = shot.pocketed.length > 0 || shot.breakRails >= 4;
      if (shot.cuePocketed) {
        match.isBreak = false;
        return foul(match, res, opp, '开球白球落袋', 'behindHead');
      }
      if (!legal) {
        match.isBreak = false;
        return foul(match, res, opp, '开球犯规：无球入袋且不足 4 球碰库', 'behindHead');
      }
      match.isBreak = false;
      res.turn = shot.pocketed.length > 0 ? shooter : opp;
      res.isBreak = false;
      res.note = shot.pocketed.length > 0
        ? '合法开球并进球，继续击打（桌面开放，未分组）'
        : '合法开球（≥4 球碰库），未进球，轮到对方';
      return res;
    }

    // ---- 非开球 ----
    var own = match.groups[shooter];
    var eightIn = shot.pocketed.indexOf(8) >= 0;

    if (eightIn) {
      // 黑八进袋：一切以黑八为准
      if (own === null) { res.loss = shooter; res.note = '桌面未分组即打进黑八，判负'; return finish(res, match, shooter); }
      var remain = ownBallsOnTable(match, world, shooter).count;
      if (remain > 0) { res.loss = shooter; res.note = '本组球未清完即打进黑八，判负'; return finish(res, match, shooter); }
      // 已清组：需要合法 + 先碰黑八
      var bad = shot.cuePocketed
        || shot.firstContactType === null
        || (shot.firstContactType !== 8)
        || (shot.pocketed.length === 0 && !shot.railAfter);
      if (bad) { res.loss = shooter; res.note = '打黑八时犯规（' + pocket8FoulReason(shot) + '），判负'; return finish(res, match, shooter); }
      res.win = shooter;
      res.note = who(shooter, match) + ' 清组后合法打落黑八 —— 获胜！';
      return finish(res, match, shooter);
    }

    // ---- 未进黑八：犯规判定 ----
    if (shot.cuePocketed) {
      return foul(match, res, opp, '白球落袋', null);
    }
    if (shot.firstContactType === null) {
      return foul(match, res, opp, '未击中任何球', null);
    }
    if (own !== null) {
      var fc = shot.firstContactType;
      if (groupOf(fc) !== own) {
        // 先碰到对方球（或黑八且己组未清）
        if (fc === 8) {
          if (ownBallsOnTable(match, world, shooter).count > 0)
            return foul(match, res, opp, '先击中黑八', null);
        } else {
          return foul(match, res, opp, '先击中非本组球', null);
        }
      }
    }
    if (shot.pocketed.length === 0 && !shot.railAfter) {
      return foul(match, res, opp, '击球后无球入袋且未碰库', null);
    }

    // ---- 未犯规：分组 / 续局 ----
    var ownIn = 0, otherIn = 0;
    for (var i = 0; i < shot.pocketed.length; i++) {
      var t = shot.pocketed[i];
      if (t === 0) continue;
      if (groupOf(t) === own) ownIn++;
      else if (groupOf(t) !== null) otherIn++;
    }

    if (own === null) {
      // 开放桌：首次合法进组球 → 分组
      var solidIn = shot.pocketed.indexOf(1) >= 0 || [1,2,3,4,5,6,7].some(function(n){ return shot.pocketed.indexOf(n) >= 0; });
      var stripeIn = shot.pocketed.indexOf(9) >= 0 || [9,10,11,12,13,14,15].some(function(n){ return shot.pocketed.indexOf(n) >= 0; });
      if (solidIn && stripeIn) {
        res.chooseGroup = true; res.turn = shooter; res.note = '同一杆打进两种球，请选择你的组';
        return res;   // 等 UI 选择
      }
      if (solidIn || stripeIn) {
        var g2 = solidIn ? 'solid' : 'stripe';
        match.groups[shooter] = g2; match.groups[opp] = g2 === 'solid' ? 'stripe' : 'solid';
        note = who(shooter, match) + ' 选择了' + groupName(g2);
      }
    }

    var continueTurn = (own !== null && ownIn > 0) ||
                       (own === null && shot.pocketed.length > 0);
    if (continueTurn) {
      res.turn = shooter; res.note = note || (own ? '进球，继续击打' : '继续击打');
      if (own === null && remainGroupBallCount(match, world, shooter) === 0 && own !== null) {
        // 已清组（若恰好在本次进球中清完）：下一杆即打黑八
        res.note = '你已经清完本组球，接下来打黑八';
      }
    } else {
      res.turn = opp; res.note = note || '未进球，轮到对方';
    }
    // 清组提示：本次进球后本组清完
    if (own !== null) {
      var rem2 = ownBallsOnTable(match, world, shooter).count;
      if (rem2 === 0) res.note = '本组球已全部进袋，接下来目标：黑八';
    }
    return res;
  }

  function remainGroupBallCount(match, world, p) { return ownBallsOnTable(match, world, p).count; }

  function finish(res, match, shooter) {
    match.winner = res.win !== null ? res.win : null;
    match.loser = res.win !== null ? 1 - res.win : (res.loss !== null ? res.loss : null);
    if (res.loss !== null) match.loser = res.loss;
    match.note = res.note;
    match.lastShot = res;
    return res;
  }

  function foul(match, res, opp, reason, handKind) {
    res.foul = true; res.reason = reason; res.turn = opp;
    res.hand = { kind: handKind || 'anywhere', forPlayer: opp };
    res.note = '犯规：' + reason + '，' + who(opp, match) + ' 获得自由球';
    match.note = res.note;
    match.lastShot = res;
    return res;
  }

  function pocket8FoulReason(shot) {
    if (shot.cuePocketed) return '白球落袋';
    if (shot.firstContactType === null || shot.firstContactType !== 8) return '未先碰黑八';
    if (shot.pocketed.length === 0 && !shot.railAfter) return '未碰库';
    return '';
  }

  function who(p, match) {
    return '玩家' + (p === 0 ? '一' : '二');
  }

  /* 白球可放置区域判定（按自由球种类）：anywhere → 全桌；behindHead → 头线后（x ≤ W*0.25） */
  function canPlaceCue(world, x, y, kind) {
    if (!globalThis.PoolPhys) return true;
    var P = globalThis.PoolPhys;
    if (kind === 'behindHead' && x > P.TABLE_W * 0.25 + 1e-9) return false;
    return P.canPlace(world, x, y);
  }

  global.PoolRules = {
    groupOf: groupOf,
    groupName: groupName,
    createMatch: createMatch,
    legalTargets: legalTargets,
    ownBallsOnTable: ownBallsOnTable,
    analyzeShot: analyzeShot,
    resolveShot: resolveShot,
    canPlaceCue: canPlaceCue,
  };
})(typeof window !== 'undefined' ? window : globalThis);