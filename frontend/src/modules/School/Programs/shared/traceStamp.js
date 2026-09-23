/**
 * The trace stamp shared by School programs' logging facades (word ladder,
 * sentence ladder). One sitting = one trace: every event logged while it is
 * bound carries the same `traceId`, an order counter, and `t` (ms since the
 * trace began), plus whatever context the program set — learner, deck,
 * corpus, day. A trace CLI orders by the counter, never by the store's
 * `_time`, which is local time mislabelled as UTC.
 *
 * The counter's key is the caller's: the word ladder calls it `seq`; the
 * sentence ladder already uses `seq` for the SENTENCE, so it stamps
 * `traceSeq` instead.
 *
 * `overridable: false` (the word ladder's contract): the stamp wins over a
 * colliding payload key. `overridable: true`: context fields yield to the
 * payload — a pacing event's `day` names the day it rolled TO — while the
 * trace id, counter and `t` always win.
 *
 * Pure bookkeeping; it does not log. Each facade owns its logger.
 */
export function randomTraceId() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let id = '';
  while (id.length < 12) id += Math.floor(Math.random() * 16).toString(16);
  return id.slice(0, 12);
}

export function createTraceStamp({
  id = randomTraceId(), orderKey = 'seq', fields = {}, overridable = false, now = Date.now,
} = {}) {
  const startedAt = now();
  let context = { ...fields };
  let count = 0;
  return {
    id,
    /** Change what the NEXT events carry. Emits nothing. */
    set(patch) { context = { ...context, ...patch }; },
    stamp(data = {}) {
      count += 1;
      const order = { traceId: id, [orderKey]: count, t: now() - startedAt };
      return overridable
        ? { ...context, ...data, ...order }
        : { ...data, ...context, ...order };
    },
  };
}

export default createTraceStamp;
