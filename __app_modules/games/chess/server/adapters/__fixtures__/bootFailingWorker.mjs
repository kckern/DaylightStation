import { parentPort } from 'node:worker_threads';

/**
 * Test-only stand-in for stockfishWorker.mjs that always fails to boot,
 * immediately and without touching the real engine. Used to cover the
 * StockfishEngineAdapter's `boot-failed` handling — specifically, that the
 * dead worker handle is terminated and nulled so a *second* search doesn't
 * post into it and wait out the full timeout before falling back.
 *
 * The real stockfishWorker.mjs registers `parentPort.on('message', ...)`
 * before it ever calls boot(), so a real boot failure leaves the thread's
 * event loop alive indefinitely on that listener — it does NOT exit on its
 * own, which is exactly what makes the dead-handle bug reachable (the
 * adapter's `worker.on('exit', ...)` handler never fires to clean it up).
 * A fixture that just posts the message and returns would let Node's worker
 * naturally exit once its top-level script finishes (nothing else keeps it
 * alive), which would mask the bug behind the adapter's *existing* 'exit'
 * handler instead of exercising the 'boot-failed' handler under test. The
 * no-op listener below reproduces that "stays alive, never replies" shape.
 */
parentPort.on('message', () => {});
parentPort.postMessage({ type: 'boot-failed', message: 'fixture: engine intentionally fails to boot' });
