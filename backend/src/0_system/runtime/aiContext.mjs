/**
 * aiContext — the entry point an AI call ran under ("origin").
 *
 * An HTTP request, a scheduled job, a Telegram webhook, a timer tick or a CLI
 * wraps its work in runWithOrigin(); anything that records AI usage further
 * down the same async chain reads currentOrigin() and stamps it on the ledger
 * row. Origin is informational — a way to find the caller of a row nobody
 * tagged. Attribution (app/feature) comes from scoped gateway views, never
 * from this.
 *
 * Nested runs: the innermost origin wins for its own scope.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Run fn with `origin` as the current origin. Returns whatever fn returns
 * (a promise stays a promise; its continuations keep the origin).
 * @template T
 * @param {string|null} origin
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithOrigin(origin, fn) {
  return storage.run({ origin: origin == null ? null : String(origin) }, fn);
}

/** The origin of the current async chain, or null outside any run. */
export function currentOrigin() {
  return storage.getStore()?.origin ?? null;
}

export default { runWithOrigin, currentOrigin };
