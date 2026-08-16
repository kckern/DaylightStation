import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Full-strength position evaluation, for reviewing a game after it was played.
 *
 * The play adapter next door deliberately weakens the engine to whatever rung a
 * child is climbing. This one never does: a review is only worth reading if the
 * yardstick is the same for every game, every rung, every player.
 *
 * Scores are always reported from WHITE's point of view, which UCI does not do
 * — UCI reports from the side to move, so an unnormalized score flips sign
 * every ply and every "who lost ground here" subtraction silently doubles.
 */
export function createStockfishAnalyst({
  workerPath = path.join(HERE, 'stockfishAnalysisWorker.mjs'),
  depth = 16,
  logger = null,
  timeoutMs = 60000,
} = {}) {
  let worker = null;
  let bootFailure = null;
  let nextId = 1;
  let queue = Promise.resolve();
  const waiting = new Map();

  function ensureWorker() {
    if (worker || bootFailure) return worker;
    worker = new Worker(workerPath);
    worker.on('message', (msg) => {
      if (msg.type === 'analysis') waiting.get(msg.id)?.resolve(msg);
      if (msg.type === 'boot-failed') {
        bootFailure = msg.message || 'stockfish failed to boot';
        logger?.warn?.('chess.analysis.boot-failed', { message: bootFailure });
        for (const entry of waiting.values()) entry.reject(new Error(bootFailure));
        worker?.terminate?.();
        worker = null;
      }
    });
    worker.on('error', (error) => {
      for (const entry of waiting.values()) entry.reject(error);
      worker?.terminate?.();
      worker = null;
    });
    worker.on('exit', () => {
      for (const entry of waiting.values()) entry.reject(new Error('stockfish worker exited'));
      worker = null;
    });
    return worker;
  }

  function probe(fen, searchDepth) {
    const live = ensureWorker();
    if (!live) return Promise.reject(new Error(bootFailure || 'stockfish unavailable'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`analysis timed out after ${timeoutMs}ms at depth ${searchDepth}`));
      }, timeoutMs);
      waiting.set(id, {
        resolve: (msg) => { clearTimeout(timer); waiting.delete(id); resolve(msg); },
        reject: (error) => { clearTimeout(timer); waiting.delete(id); reject(error); },
      });
      live.postMessage({ type: 'analyse', id, fen, depth: searchDepth });
    });
  }

  return {
    /**
     * Evaluate one position.
     *
     * Returns `{ cp, mate, bestUci, terminal }`, white-positive. `terminal` is
     * true for a position with no legal moves — checkmate or stalemate already
     * on the board — where there is nothing to score and no best move.
     */
    async evaluate(fen, { depth: overrideDepth = depth } = {}) {
      // Serialized: one WASM engine, and concurrent `go` commands on a single
      // UCI session interleave into nonsense.
      const run = queue.then(() => probe(fen, overrideDepth));
      queue = run.catch(() => {});
      const msg = await run;
      const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
      const sign = turn === 'w' ? 1 : -1;
      if (!msg.score) return { cp: null, mate: null, bestUci: null, terminal: true };
      return {
        cp: msg.score.cp == null ? null : msg.score.cp * sign,
        mate: msg.score.mate == null ? null : msg.score.mate * sign,
        depth: msg.score.depth,
        bestUci: msg.bestUci,
        terminal: false,
      };
    },
    dispose() {
      worker?.terminate?.();
      worker = null;
      waiting.clear();
    },
  };
}

export default { createStockfishAnalyst };
