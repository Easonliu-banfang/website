/* 四子棋 AI Web Worker
 * 在后台线程跑 Minimax + Alpha-Beta 迭代加深搜索，避免阻塞主线程，
 * 从而让「电脑思考时」用户走子动画、AI 走子动画都流畅播放，不再卡顿。
 */
importScripts('connect4-engine.js?v=c5', 'connect4-ai.js?v=c5');

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || msg.type !== 'think') return;
  try {
    var C = self.Connect4;
    var AI = self.Connect4AI;
    if (!C || !AI) {
      self.postMessage({ type: 'error', reqId: msg.reqId, message: 'engine/ai 未加载' });
      return;
    }
    // bestMove 内部会 clone state，不修改传入的 state
    var col = AI.bestMove(msg.state, msg.aiSide);
    self.postMessage({ type: 'move', reqId: msg.reqId, col: col });
  } catch (err) {
    self.postMessage({
      type: 'error',
      reqId: msg.reqId,
      message: (err && err.message) ? err.message : String(err)
    });
  }
};