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

function readSlot(slot) {
  if (!slot.resolve) return slot.value;
  try {
    const value = slot.resolve();
    return value == null ? null : String(value);
  } catch {
    return null;
  }
}

/**
 * An origin slot: a fixed string, or a resolver read lazily until the slot is
 * settled. settle() snapshots the resolver's current answer and drops the
 * resolver, so whatever it closed over (an HTTP request) is released even if
 * a timer or pending promise keeps the async context alive afterwards.
 * @param {string|(() => string|null)|null} origin
 * @returns {{ resolve: Function|null, value: string|null, settle: () => void }}
 */
export function originSlot(origin) {
  const slot = typeof origin === 'function'
    ? { resolve: origin, value: null }
    : { resolve: null, value: origin == null ? null : String(origin) };
  slot.settle = () => {
    if (!slot.resolve) return;
    slot.value = readSlot(slot);
    slot.resolve = null;
  };
  return slot;
}

/** Run fn inside an existing slot (see originSlot). */
export function runInOriginSlot(slot, fn) {
  return storage.run(slot, fn);
}

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
  return storage.run(originSlot(origin), fn);
}

/** The origin of the current async chain, or null outside any run. */
export function currentOrigin() {
  const slot = storage.getStore();
  return slot ? readSlot(slot) : null;
}

/** The slot of the current async chain (diagnostics and tests). */
export function currentOriginSlot() {
  return storage.getStore() ?? null;
}

export default { runWithOrigin, runInOriginSlot, originSlot, currentOrigin, currentOriginSlot };
