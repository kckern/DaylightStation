import { parentPort } from 'node:worker_threads';
import { chooseMove } from '../../../../shared/gaming/rulesets/chess/opponent.mjs';

/**
 * The homegrown opponent, isolated from the event loop.
 *
 * Its search is a plain negamax over chess.js move generation — cheap at depth
 * 1, but a depth-2 rung measured 3–14 s per move on 2026-10-02, and every one
 * of those seconds froze the whole backend: the school Portal's code lookups
 * sat behind a child's chess game for 28 s. Same reasoning as
 * stockfishWorker.mjs, minus UCI: options in, plain move out.
 */
parentPort.on('message', (msg) => {
  if (msg?.type !== 'choose') return;
  try {
    const move = chooseMove(msg.fen, msg.options);
    // The move object carries the post-move FEN and chess.js internals; only
    // the fields the adapter returns cross the thread boundary.
    parentPort.postMessage({
      type: 'chosen',
      id: msg.id,
      move: move ? {
        from: move.from,
        to: move.to,
        ...(move.promotion ? { promotion: move.promotion } : {}),
        san: move.san,
      } : null,
    });
  } catch (error) {
    parentPort.postMessage({ type: 'chosen', id: msg.id, error: error?.message ?? String(error) });
  }
});
