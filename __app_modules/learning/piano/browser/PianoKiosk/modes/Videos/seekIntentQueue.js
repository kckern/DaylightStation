/** One media seek in flight plus its latest admitted target. Admission/credit
 * remain the caller's responsibility. A deadline drops work, never retries it.
 */
export function createSeekIntentQueue({
  seek, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 5000,
}) {
  let mediaKey;
  let inFlight = null;
  let pending = null;
  let timer = null;
  let startedAt = 0;
  let disposed = false;
  let attempt = 0;

  const clear = () => {
    attempt += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    inFlight = null;
    pending = null;
  };
  const expire = () => {
    if (inFlight && now() - startedAt >= timeoutMs) clear();
  };
  const start = (intent) => {
    inFlight = intent;
    startedAt = now();
    const ticket = ++attempt;
    timer = setTimer(() => {
      // A cancelled timer may already have been queued before a media reset.
      if (ticket === attempt) clear();
    }, timeoutMs);
    try { seek(intent); } catch (error) { clear(); throw error; }
  };
  return {
    // Read before calculating a relative target: the timer may be delayed by
    // the same busy event loop that delivered this next control press.
    getTarget() {
      expire();
      return pending?.target ?? inFlight?.target ?? null;
    },
    request(intent) {
      if (disposed || intent.mediaKey !== mediaKey || !Number.isFinite(intent.target)) return;
      expire();
      if (inFlight) pending = intent;
      else start(intent);
    },
    complete({ mediaKey: completedKey }) {
      if (disposed || completedKey !== mediaKey || !inFlight) return;
      const next = now() - startedAt < timeoutMs ? pending : null;
      const completedTarget = inFlight.target;
      clear();
      if (next && next.target !== completedTarget) start(next);
    },
    reset(nextKey) { clear(); mediaKey = nextKey; },
    dispose() { clear(); disposed = true; },
  };
}
