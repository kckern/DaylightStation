/**
 * Debounce stage factory. Per-key sliding window with prune-on-check.
 * Mirrors the 30s window semantics previously inline in TriggerDispatchService.
 * Layer: APPLICATION.
 * @module applications/trigger/guards/debounce
 */
export function createDebounce({ windowMs = 30000 } = {}) {
  const recent = new Map(); // key -> timestampMs
  const prune = (now) => {
    for (const [k, ts] of recent) if (now - ts > windowMs) recent.delete(k);
  };
  return {
    check(key, now) {
      prune(now);
      const last = recent.get(key);
      if (last != null && now - last < windowMs) return { debounced: true, sinceMs: now - last };
      return { debounced: false };
    },
    set(key, now) { recent.set(key, now); },
    delete(key) { recent.delete(key); },
  };
}
export default createDebounce;
