/* Quoridor AI Web Worker
 * 在后台线程跑 Minimax + Alpha-Beta 搜索，避免阻塞主线程，
 * 从而让「电脑思考时」用户的走子动画、AI 自己的走子动画都能流畅播放。
 *
 * 通过 importScripts 复用与主页同一份 engine.js / ai.js（同域名、同源），
 * 二者在 Worker 内会挂到 globalThis（window 不存在时走 globalThis 分支）。
 */
importScripts('engine.js?v=g9', 'ai.js?v=g9');

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || msg.type !== 'think') return;
  try {
    var Q = self.Quoridor;
    var AI = self.QuoridorAI;
    if (!Q || !AI) {
      self.postMessage({ type: 'error', reqId: msg.reqId, message: 'engine/ai 未加载' });
      return;
    }
    // bestMove 内部会 clone state，不会改动传入的 state
    var mv = AI.bestMove(msg.state, msg.aiSide, msg.opts || {});
    self.postMessage({ type: 'move', reqId: msg.reqId, move: mv });
  } catch (err) {
    self.postMessage({
      type: 'error',
      reqId: msg.reqId,
      message: (err && err.message) ? err.message : String(err)
    });
  }
};
