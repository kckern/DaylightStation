import { createRequire } from 'node:module';

/**
 * Boot the bundled Stockfish WASM from inside a worker thread.
 *
 * Shared by both engine workers — the play worker (`stockfishWorker.mjs`) and
 * the review worker (`stockfishAnalysisWorker.mjs`). The `isMainThread` flip
 * below is subtle enough that a second copy of it would be a liability: if the
 * upstream package ever changes that branch, one copy would be fixed and the
 * other left to rot.
 */
const require = createRequire(import.meta.url);
const initEngine = require('stockfish');

/**
 * stockfish@18's built engine JS special-cases "running inside a Node
 * worker_thread" (global.process + !isMainThread) as a no-op branch that
 * assumes browser-Worker semantics (self/onmessage) it never actually wires
 * up for Node. Left alone, `require(pathToEngine)` inside the package's
 * `initEngine()` returns `{}` and boot() rejects with "Could not load the
 * engine correctly." — which is exactly the environment these workers run
 * in, since the whole point of putting Stockfish off-thread is to keep its
 * search off the event loop. `isMainThread` is a plain, writable property on
 * the (thread-local, cached) `worker_threads` module, not a getter, so
 * flipping it for the duration of the synchronous `require()` inside
 * `initEngine()` steers it down the normal `module.exports = <factory>` path
 * instead. The flip only needs to bracket that synchronous require —
 * `initEngine()` returns a Promise for the (genuinely async) WASM
 * instantiation, so the value is restored before anything awaits it.
 */
export function loadEngineFactory(variant = 'lite-single') {
  const workerThreads = require('worker_threads');
  const original = workerThreads.isMainThread;
  workerThreads.isMainThread = true;
  try {
    return initEngine(variant);
  } finally {
    workerThreads.isMainThread = original;
  }
}

export default { loadEngineFactory };
