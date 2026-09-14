/* 统一结算覆盖层（Result Overlay）—— 全站游戏共用组件
 *
 * 用法：
 *   ResultOverlay.show({
 *     game: '四子棋',                  // 游戏名（纯中文，不带英文缩写）
 *     title: '🎉 你赢了！',            // 主标题
 *     sub: '红方四连 · 第 23 手制胜',   // 副标题（对局摘要）
 *     meRank: 1,                       // 我的名次（1=冠军，非 1 → 自动切输局冷色调）
 *     me: { name, score, tag, avatar },// 我的成绩（avatar 可选，URL；缺省用默认头像）
 *     players: [{ name, score, tag, avatar }],  // 全部玩家，按名次排（冠军在前）
 *     stats: [['对局手数', '23'], ...],          // 对局数据行（可选）
 *     onClose: fn                      // 关闭回调（可选）
 *   });
 *   ResultOverlay.hide();
 *
 * 头像：默认统一使用内置 SVG 占位头像（DEFAULT_AVATAR）；玩家对象带 avatar（URL）
 *       时自动渲染 <img>。将来接入真实头像只需在 players/me 里传 avatar 字段。
 */
(function (global) {
  'use strict';

  var RANK_CN = ['', '冠军', '亚军', '季军', '第 4 名'];
  var MEDAL = ['', '🥇', '🥈', '🥉', '🎖'];

  // 默认头像（内置 SVG data URI：深色底 + 白色羊形剪影，全站统一）
  var DEFAULT_AVATAR = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCACAAIADASIAAhEBAxEB/8QAGwAAAgMBAQEAAAAAAAAAAAAAAAECBAUDBgf/xAAwEAACAgECBAQEBQUAAAAAAAAAAQIRAwQSBSFBUTEyYXETIpGxFEJy4fEjM1Jiof/EABgBAQEBAQEAAAAAAAAAAAAAAAABAgME/8QAFxEBAQEBAAAAAAAAAAAAAAAAAAERMf/aAAwDAQACEQMRAD8A+C2Ah2ehxAAAAILE2QJiGwRFMAAAAAGAAAAAAACxkQsqJeAN0RsBodiEOMZTkoxi5SfgkrbCkSNXS8AnNKWoyfDT/JHm/qXY8G0UOXw5S9ZSYxNedA9DPg+jkqWNxfeMmUdTwScE5YJ71/jLkxhrMAcouEnGUXGS8U1zQgoAAIAAABUFDABUFDAAUHOSjFNybpJdWek4bw6GixpySeZr5pdvRGbwPTrJqJZpL+2vl92btmolNiCxWaQMiwsTZBU4hoY6yG5Usq8su/ozAacW4yTTTpp9D1Ji8YwKGeOWK5ZFz90SxYz2gGCMqQAAD6iGACAYgNzgaS0kn1c39kaNmVwPJeHLj6xlu+v8GnZuMpWJsVisoYgFYAzP4yr00X2mvsy+ZvGslYsePq5bvp/JLwZQABzaDAGCKDqAdQABMAAsaHU/hdRGb8j5S9j0KkpJNO0+aa6nli9oOJPTVjy3LF0rxj+xqVK27CyGPLDNDfjkpR7okaQWAEcmWGGG/JJQj3YDclFNtpJeLfQ8/rdT+K1EpryrlH2O2v4i9TePHccXXvL9ikZtU7AQ0ZUMEAgAaEMAEdMODJnltxq+76I0cHDcWNXk/qS9fAsiMyGOeV1CEpP0RZhwvPPnLbBerv7Gqqiqikl2XIGy4MaWn1Wkk5RU41+aDJx4tq48nOMv1RRq2RkoyfOMX7oYMyXFtXLkpxj+mJzWHU6qW6W+X+034GqlFeWMV7ILGDNnw7NHy7Z+zOE4TxupxcfdGxYOpKmk12YwY3UDQy6LHPnD5Jf8KWXDPDKpr2fRmbFQYhsQDZ00+B6jJt8EubfZHNmjoofDwp9Zc2WC1jjHFBRgkkiW457hbjSOjYtxDcR3AT3CbIWwsCdisjfqKwJWOyFhdjRKxTUckXGStMVismihmxPDPb4ro+5yL2qjvxN9Y8ykZCZqxe2KXZUZZo2WDpYrshY7KJWK+ZFsVsCVhZGwsCVibI2AErHfIhY7Ad2FkbCwG+aa7meXygSj/9k=';

  var root = null, els = {}, cv = null, ctx2 = null, raf = null, parts = [];
  var seqTimers = [];
  var current = null;

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'ro-overlay hidden';
    root.innerHTML =
      '<div class="ro-godray"></div>' +
      '<div class="ro-grid"></div>' +
      '<canvas class="ro-px"></canvas>' +
      '<button class="ro-close" type="button" title="关闭">✕</button>' +
      '<div class="ro-stage">' +
        '<div class="ro-game"></div>' +
        '<div class="ro-trophy-wrap"><span class="ro-trophy">🏆</span><span class="ro-trophy-ring"></span></div>' +
        '<div class="ro-title"></div>' +
        '<div class="ro-sub"></div>' +
        '<div class="ro-me">' +
          '<div class="ro-me-l">' +
            '<div class="ro-ava"></div>' +
            '<div class="ro-me-info">' +
              '<div class="ro-me-eyebrow">MY SCORE</div>' +
              '<div class="ro-me-name"></div>' +
              '<div class="ro-me-rank"></div>' +
            '</div>' +
          '</div>' +
          '<div class="ro-me-r">' +
            '<div class="ro-me-sc-label">得分</div>' +
            '<div class="ro-me-sc">0</div>' +
            '<div class="ro-me-tag"></div>' +
          '</div>' +
        '</div>' +
        '<div class="ro-podium"></div>' +
        '<div class="ro-stats"></div>' +
      '</div>';
    document.body.appendChild(root);

    els.game = root.querySelector('.ro-game');
    els.trophy = root.querySelector('.ro-trophy');
    els.title = root.querySelector('.ro-title');
    els.sub = root.querySelector('.ro-sub');
    els.ava = root.querySelector('.ro-ava');
    els.meName = root.querySelector('.ro-me-name');
    els.meRank = root.querySelector('.ro-me-rank');
    els.meScore = root.querySelector('.ro-me-sc');
    els.meTag = root.querySelector('.ro-me-tag');
    els.podium = root.querySelector('.ro-podium');
    els.stats = root.querySelector('.ro-stats');
    els.close = root.querySelector('.ro-close');
    cv = root.querySelector('.ro-px');
    ctx2 = cv.getContext('2d');

    els.close.addEventListener('click', hide);
    global.addEventListener('resize', sizeCanvas);
  }

  function sizeCanvas() {
    if (!cv) return;
    cv.style.width = innerWidth + 'px';
    cv.style.height = innerHeight + 'px';
    cv.width = innerWidth * devicePixelRatio;
    cv.height = innerHeight * devicePixelRatio;
    ctx2.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  /* 左右对称礼花：成对镜像生成，同一帧同时喷出 */
  function burst(won) {
    parts = [];
    var palette = won
      ? ['#ffd76a', '#ff9d5c', '#fff', '#b180ff', '#6fa8ff', '#ff6b81', '#4ade80', '#ffb15c']
      : ['#aeb8d8', '#8fa2d8', '#6a76a8', '#c9d4e8', '#ffffff', '#b180ff'];
    var W = innerWidth, H = innerHeight;
    var scale = Math.min(W, H) / 720;
    var nPerSide = Math.max(45, Math.min(200, Math.round(150 * scale)));
    var midY = H * 0.38;
    var leftX = W * 0.03, rightX = W * 0.97;
    var lifeBase = 0.9 + scale * 0.5;
    for (var i = 0; i < nPerSide; i++) {
      var spd = (4.5 + Math.random() * 12) * scale * 1.15;
      var r = (2 + Math.random() * 6) * Math.max(0.6, scale);
      var dy = (Math.random() - 0.5) * H * 0.3;
      var vy = -spd * (0.7 + Math.random() * 0.55);
      var hx = spd * 0.85 + (Math.random() - 0.5) * 3;
      var col = palette[(Math.random() * palette.length) | 0];
      var decay = 0.006 + Math.random() * 0.011;
      var rot = Math.random() * Math.PI * 2, vr = (Math.random() - 0.5) * 0.3;
      var shape = Math.random() < 0.5 ? 0 : 1;
      parts.push({ x: leftX, y: midY + dy, vx: hx, vy: vy, r: r, c: col, life: lifeBase, decay: decay, rot: rot, vr: vr, shape: shape });
      parts.push({ x: rightX, y: midY + dy, vx: -hx, vy: vy, r: r, c: col, life: lifeBase, decay: decay, rot: -rot, vr: vr, shape: shape });
    }
    if (raf) cancelAnimationFrame(raf);
    (function tick() {
      ctx2.clearRect(0, 0, innerWidth, innerHeight);
      var alive = 0;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.22; p.vx *= 0.99; p.vy *= 0.99;
        p.life -= p.decay; p.rot += p.vr;
        if (p.x < -12 || p.x > innerWidth + 12 || p.y < -12 || p.y > innerHeight + 12) p.life = 0;
        if (p.life <= 0) continue;
        alive++;
        ctx2.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx2.fillStyle = p.c;
        ctx2.save(); ctx2.translate(p.x, p.y); ctx2.rotate(p.rot);
        if (p.shape === 0) { ctx2.beginPath(); ctx2.arc(0, 0, p.r, 0, Math.PI * 2); ctx2.fill(); }
        else { ctx2.fillRect(-p.r, -p.r, p.r * 2, p.r * 2); }
        ctx2.restore();
      }
      ctx2.globalAlpha = 1;
      if (alive > 0) raf = requestAnimationFrame(tick);
    })();
  }

  /* 数字滚动（仅纯数字；字母/级分直接显示） */
  function rollScore(el, target, isNum) {
    if (!isNum) { el.textContent = String(target); return; }
    var max = parseFloat(target) || 0;
    var hasDot = String(target).indexOf('.') >= 0;
    var dur = 900, t0 = performance.now();
    el.textContent = '0';
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = hasDot ? (max * e).toFixed(1) : Math.round(max * e).toString();
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function avatarHTML(av) {
    // 预留真实头像：传入 avatar（URL / dataURI）则渲染 img，否则用默认头像
    var src = av || DEFAULT_AVATAR;
    return '<img src="' + src + '" alt="" onerror="this.src=\'' + DEFAULT_AVATAR + '\'">';
  }

  function clearTimers() {
    for (var i = 0; i < seqTimers.length; i++) clearTimeout(seqTimers[i]);
    seqTimers = [];
  }

  function playSequence() {
    clearTimers();
    if (raf) cancelAnimationFrame(raf);
    var loseFlag = current && current.meRank !== 1;
    var l2pFlag = current && current.local2p;
    root.className = 'ro-overlay show' + (loseFlag ? ' lose' : '') + (l2pFlag ? ' local2p' : '');
    void root.offsetWidth;
    root.classList.add('s1');
    seqTimers.push(setTimeout(function () {
      root.classList.add('s2');
      burst(!loseFlag);
      seqTimers.push(setTimeout(function () {
        root.classList.add('s3');
        var sc = els.meScore;
        rollScore(sc, current._scoreStr, current._scoreIsNum);
        seqTimers.push(setTimeout(function () { root.classList.add('s4'); }, 420));
      }, 900));
    }, 320));
  }

  function normalize(o) {
    // 统一数据结构 + 补齐默认值（3 人以上也支持；多人时仅前 4 名上领奖台）
    o = o || {};
    var players = (o.players || []).slice(0, 4);
    var meRank = o.meRank || 1;
    var me = o.me || players[Math.max(0, meRank - 1)] || { name: '我', score: '0', tag: '' };
    if (players.length === 0) {
      players = [{ name: me.name, score: me.score, tag: me.tag, avatar: me.avatar }];
      meRank = 1;
    }
    return {
      game: o.game || '',
      title: o.title || '',
      sub: o.sub || '',
      meRank: meRank,
      me: me,
      players: players,
      stats: o.stats || [],
      onClose: o.onClose || null,
      local2p: !!o.local2p          // 双人同屏：只显示排行榜，不显示成绩卡/不标「我」
    };
  }

  // 读本地保存的用户头像（注册/登录时存 localStorage.game_avatar）
  function myAvatar() {
    try {
      var a = localStorage.getItem('game_avatar');
      return (a && a.indexOf('data:image/') === 0) ? a : null;
    } catch (e) { return null; }
  }

  function render(d) {
    els.game.textContent = d.game;
    els.title.textContent = d.title;
    els.sub.textContent = d.sub;
    els.trophy.textContent = d.meRank === 1 ? '🏆' : '🥈';

    var saved = myAvatar();

    // 我的成绩（优先显式 avatar，其次本地用户头像）；双人同屏不显示成绩卡
    els.ava.innerHTML = avatarHTML(d.me.avatar || saved);
    if (root) root.classList.toggle('local2p', !!d.local2p);
    els.meName.textContent = d.me.name;
    els.meRank.textContent = (MEDAL[d.meRank] || '🎖') + ' 第 ' + d.meRank + ' 名 · ' + (RANK_CN[d.meRank] || '第 ' + d.meRank + ' 名');
    els.meTag.textContent = d.me.tag || '';
    var scStr = String(d.me.score == null ? '' : d.me.score);
    d._scoreStr = scStr;
    d._scoreIsNum = /^\d+(\.\d+)?$/.test(scStr);
    els.meScore.textContent = d._scoreIsNum ? '0' : scStr;

    // 领奖台：冠军居中（2人 [亚军,冠军] / 3人 [亚军,冠军,季军] / 4人 [亚军,冠军,季军,4]）
    var players = d.players;
    var n = players.length;
    var order = n === 2 ? [1, 0] : [1, 0, 2].concat(n >= 4 ? [3] : []);
    var html = '';
    for (var pos = 0; pos < order.length; pos++) {
      var idx = order[pos];
      var p = players[idx];
      if (!p) continue;
      var rank = idx + 1;
      var isMe = !d.local2p && rank === d.meRank;
      var pAv = (d.local2p ? null : (p.avatar || (isMe ? saved : null)));
      html += '<div class="ro-col ro-r' + rank + (isMe ? ' me' : '') + '">' +
        (isMe ? '<div class="ro-flag">我</div>' : '') +
        '<div class="ro-pava">' + avatarHTML(pAv) + '</div>' +
        '<div class="ro-pillar">' +
          '<div class="ro-pn">' + p.name + (isMe ? '（我）' : '') + '</div>' +
          '<div class="ro-ps">' + p.score + ' 分</div>' +
          '<div class="ro-pt">' + (p.tag || '') + '</div>' +
        '</div>' +
      '</div>';
    }
    els.podium.innerHTML = html;
    var cols = els.podium.querySelectorAll('.ro-col');
    for (var i = 0; i < cols.length; i++) cols[i].style.transitionDelay = (0.25 + i * 0.09) + 's';

    // 数据行
    els.stats.innerHTML = (d.stats || []).map(function (s) {
      return '<div class="ro-chip">' + s[0] + ' <b>' + s[1] + '</b></div>';
    }).join('');
  }

  function show(opts) {
    build();
    current = normalize(opts);
    render(current);
    sizeCanvas();
    root.classList.remove('hidden');
    playSequence();
  }

  function hide() {
    if (!root) return;
    clearTimers();
    if (raf) cancelAnimationFrame(raf);
    if (ctx2) ctx2.clearRect(0, 0, innerWidth, innerHeight);
    root.classList.remove('show', 's1', 's2', 's3', 's4');
    var cb = current && current.onClose;
    var t = setTimeout(function () { if (root) root.classList.add('hidden'); }, 340);
    seqTimers.push(t);
    if (cb) { try { cb(); } catch (e) {} }
  }

  global.ResultOverlay = {
    show: show,
    hide: hide,
    DEFAULT_AVATAR: DEFAULT_AVATAR
  };
})(typeof window !== 'undefined' ? window : globalThis);
