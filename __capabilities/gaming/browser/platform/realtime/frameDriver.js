const defaultNow = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

/**
 * One requestAnimationFrame loop with a clamped step.
 *
 * `onFrame({ nowMs, rawElapsedS, elapsedS })` runs each frame; `elapsedS` is
 * `rawElapsedS` capped at `maxFrameS` (so a backgrounded tab does not produce one
 * giant step). Returning `false` parks the loop; `wake()` re-arms it. A throwing
 * `onFrame` is isolated and the loop continues.
 *
 * `raf`/`caf` default to the GLOBALS, resolved at call time (tests stub them after
 * import). Pass `null` to force the no-rAF mode: `start()`/`wake()` do nothing.
 */
export function createFrameDriver({
  onFrame,
  maxFrameS = Infinity,
  now = defaultNow,
  raf,
  caf,
} = {}) {
  const getRaf = () => (raf !== undefined ? raf : globalThis.requestAnimationFrame);
  const getCaf = () => (caf !== undefined ? caf : globalThis.cancelAnimationFrame);

  let running = false;
  let rafId = 0;
  let prior = 0;

  const frame = (ts) => {
    rafId = 0;
    if (!running) return;
    const nowMs = typeof ts === 'number' ? ts : now();
    const rawElapsedS = Math.max(0, nowMs - prior) / 1000;
    const elapsedS = Math.min(maxFrameS, rawElapsedS);
    prior = nowMs;
    let keepGoing = true;
    try {
      keepGoing = onFrame({ nowMs, rawElapsedS, elapsedS }) !== false;
    } catch (e) { /* isolated: the loop continues */ }
    if (!running) return; // onFrame may have called stop()
    if (keepGoing) {
      rafId = getRaf()(frame);
    } else {
      running = false;
    }
  };

  const arm = () => {
    const request = getRaf();
    if (typeof request !== 'function') return;
    prior = now();
    if (running) return;
    running = true;
    rafId = request(frame);
  };

  return {
    start() { arm(); },
    wake() { arm(); },
    stop() {
      running = false;
      const cancel = getCaf();
      if (rafId && typeof cancel === 'function') cancel(rafId);
      rafId = 0;
    },
    get running() { return running; },
  };
}

export default createFrameDriver;
