import { Worker } from 'node:worker_threads';

/**
 * Reusable worker lifecycle for CPU-bound piano-game opponents.
 *
 * Game adapters still own validation and fallback policy. This class owns only
 * the infrastructure concerns proven by Stockfish: lazy spawn, one-at-a-time
 * searches, request correlation, bounded waiting, recovery, and disposal.
 */
export function createSerializedWorkerOpponent({ workerPath, logger = null, logPrefix, timeoutMs = 1000 }) {
  let worker = null;
  let queue = Promise.resolve();
  let nextId = 1;
  const waiting = new Map();

  function settleAll() {
    for (const entry of waiting.values()) entry.resolve(null);
  }

  function ensureWorker() {
    if (worker) return worker;
    try {
      worker = new Worker(workerPath);
      worker.on('message', (message) => {
        const entry = waiting.get(message.id);
        if (!entry) return;
        if (message.type === 'bestmove') entry.resolve(message.move);
        if (message.type === 'failed') {
          logger?.warn?.(`${logPrefix}.worker-search-failed`, { message: message.message });
          entry.resolve(null);
        }
      });
      worker.on('error', (error) => {
        logger?.warn?.(`${logPrefix}.worker-error`, { message: error?.message });
        settleAll();
        worker?.terminate?.();
        worker = null;
      });
      worker.on('exit', () => {
        settleAll();
        worker = null;
      });
      worker.unref?.();
    } catch (error) {
      logger?.warn?.(`${logPrefix}.worker-spawn-failed`, { message: error?.message });
      worker = null;
    }
    return worker;
  }

  function run(payload) {
    const live = ensureWorker();
    if (!live) return Promise.resolve(null);
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        live.postMessage({ type: 'abandon', id });
        logger?.warn?.(`${logPrefix}.timeout`, { timeoutMs });
        resolve(null);
      }, timeoutMs);
      waiting.set(id, {
        resolve: (move) => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(move);
        },
      });
      live.postMessage({ type: 'search', id, ...payload });
    });
  }

  return {
    search(payload) {
      const search = queue.then(() => run(payload));
      queue = search.catch(() => {});
      return search;
    },
    dispose() {
      worker?.terminate?.();
      worker = null;
      settleAll();
      waiting.clear();
    },
  };
}

export default { createSerializedWorkerOpponent };
