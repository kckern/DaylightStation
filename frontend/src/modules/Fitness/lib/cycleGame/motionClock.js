import { tickFraction } from './tickFraction.js';

/**
 * One shared, linear motion clock for a panel's data-driven positions.
 *
 * The engine ticks at ~1 Hz, so every rendered datum (chart tip, terminus tags,
 * speedo needle, oval markers, odometer) would otherwise jump once per second.
 * `createTickLerp` runs a SINGLE rAF loop per instance and, on every frame,
 * reports a LINEAR fraction 0→1 measured from the last `onTick()` across
 * `intervalMs` (reusing `tickFraction` semantics). Consumers lerp their own
 * `prev → cur` positions by that fraction and write them to the DOM imperatively —
 * so React never re-renders per frame (the PovGrid pattern).
 *
 * Contract:
 *   - `onTick(payload)`  — a new data tick arrived; resets the fraction to 0 and
 *                          re-arms the loop. `payload` is passed through to every
 *                          subscriber unchanged.
 *   - `subscribe(cb)`    — `cb(fraction, payload)` each frame; returns an unsubscribe.
 *   - `stop()`           — cancel the loop and drop all subscribers.
 *
 * The loop PARKS itself once the fraction saturates at 1 (data is static between
 * ticks) and re-arms on the next `onTick`, so an idle panel costs nothing. Motion
 * is LINEAR by design — the data is a rate, and easing would add false dynamics.
 *
 * `now` is injectable for deterministic tests; it defaults to `performance.now`.
 */
export function createTickLerp({ intervalMs = 1000, now } = {}) {
  const readNow = typeof now === 'function'
    ? now
    : () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

  const subs = new Set();
  let tickAt = readNow();
  let payload;
  let rafId = 0;
  let running = false;

  const emit = (f) => {
    subs.forEach((cb) => {
      // A subscriber throwing must never tear down the loop for its siblings.
      try { cb(f, payload); } catch (e) { /* noop */ }
    });
  };

  const frame = () => {
    rafId = 0;
    if (!running) return;
    const f = tickFraction(readNow(), tickAt, intervalMs);
    emit(f);
    if (f < 1) {
      rafId = requestAnimationFrame(frame);
    } else {
      running = false; // park at the tick; the next onTick re-arms
    }
  };

  return {
    onTick(next) {
      payload = next;
      tickAt = readNow();
      if (typeof requestAnimationFrame === 'undefined') {
        // No rAF host (SSR / bare unit env): land subscribers on the current tick.
        emit(1);
        return;
      }
      if (!running) {
        running = true;
        rafId = requestAnimationFrame(frame);
      }
    },
    subscribe(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    stop() {
      running = false;
      if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
      rafId = 0;
      subs.clear();
    },
    get running() { return running; },
  };
}

export default createTickLerp;
