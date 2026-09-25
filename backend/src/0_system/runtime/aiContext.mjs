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
 *
 * An origin may be a function, resolved each time currentOrigin() is read.
 * The HTTP middleware uses this: the matched route pattern is only known once
 * routing has happened, which is after the context has to be opened.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Run fn with `origin` as the current origin. Returns whatever fn returns
 * (a promise stays a promise; its continuations keep the origin).
 * @template T
 * @param {string|(() => string|null)|null} origin - a string, or a resolver
 *   read lazily by currentOrigin()
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithOrigin(origin, fn) {
  const slot = typeof origin === 'function'
    ? { resolve: origin }
    : { resolve: null, value: origin == null ? null : String(origin) };
  return storage.run(slot, fn);
}

/** The origin of the current async chain, or null outside any run. */
export function currentOrigin() {
  const slot = storage.getStore();
  if (!slot) return null;
  if (!slot.resolve) return slot.value;
  try {
    const value = slot.resolve();
    return value == null ? null : String(value);
  } catch {
    return null;
  }
}

export default { runWithOrigin, currentOrigin };
