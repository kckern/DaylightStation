/**
 * useMediaClock — an independent playhead subscriber for the player surround frame.
 *
 * WHY THIS IS NOT SHARED WITH `useContentFilter.js`
 * -------------------------------------------------
 * `useContentFilter.js` runs its own rVFC driver (see its effect around :250-285).
 * That driver is entangled with skip-card timers whose cleanup is deliberately
 * asymmetric, with cue enter/exit bookkeeping and with overlay fade lifetimes.
 * Extracting it would put a shipped content filter at risk for no benefit here,
 * so this module COPIES the pattern and runs a second, parallel subscriber.
 * `requestVideoFrameCallback` supports multiple concurrent callbacks on the same
 * element, so both loops coexist.
 *
 * SAMPLING RATE
 * -------------
 * The raw driver ticks at the display frame rate (~40Hz on this hardware). React
 * state is sampled at 10Hz by default. Kiosk pages in this house have degraded to
 * 10fps, and re-rendering every surround module 40x/sec is the likeliest way to
 * reproduce that. A cursor on a 54-minute piece moves under 0.04%/second, so
 * sub-frame precision buys nothing a human can see. Do not "improve" this to
 * per-frame updates.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../logging/Logger.js';

// Lazy module-level logger: `getLogger()` at import time would bind before the app
// configures the logger (CLAUDE.md, "Module-Level Loggers").
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'surround', component: 'media-clock' });
  return _logger;
}

/** Events that must re-read the playhead. Attached whether or not rVFC is available. */
const TICK_EVENTS = ['timeupdate', 'seeked', 'ratechange', 'playing', 'waiting', 'pause', 'ended'];

/** How often the supervisor re-resolves the element and checks stall/health. */
const SUPERVISOR_MS = 250;

/** Playing, but no tick for this long => the driver is dead and the cursor is frozen. */
const STALL_MS = 5000;

/** Health is computed over windows of at least this long, then rate-limited to 1/min. */
const HEALTH_WINDOW_MS = 1000;

const ZERO_STATE = Object.freeze({ position: 0, duration: 0, playing: false, seeking: false });

const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * Create a media clock. Framework-free so it can be unit-tested without React.
 *
 * @param {object} opts
 * @param {() => (HTMLMediaElement|null)} opts.getMediaEl  Re-read on every supervisor
 *   pass, so a late mount, an element swap, and an unmount are all handled without
 *   the caller re-creating the clock.
 * @param {string} [opts.contentId] Correlation id carried on every emitted event.
 * @returns {{ subscribe: (cb: Function) => Function, getState: () => object,
 *            start: () => void, stop: () => void, recordReactSample: () => void }}
 */
export function createMediaClock({ getMediaEl, contentId = null } = {}) {
  let state = { ...ZERO_STATE };
  const subscribers = new Set();

  let el = null;             // currently attached element
  let driver = null;         // 'rvfc' | 'timeupdate' | null
  let rvfcHandle = null;
  let supervisor = null;
  let running = false;
  let stopped = false;

  let lastTickAt = 0;
  let stallWarned = false;

  // Health counters. `ticks` is the raw driver rate; `reactSamples` is what actually
  // reached React — the pair is what makes 10Hz-vs-40Hz a log query instead of a
  // trip to the living room.
  let windowStart = 0;
  let ticks = 0;
  let reactSamples = 0;

  const notify = () => {
    const snapshot = state;
    subscribers.forEach((cb) => {
      try { cb(snapshot); } catch (_) { /* a bad subscriber must not kill the clock */ }
    });
  };

  const setState = (next) => {
    const changed = next.position !== state.position
      || next.duration !== state.duration
      || next.playing !== state.playing
      || next.seeking !== state.seeking;
    state = next;
    if (changed) notify();
  };

  const tick = () => {
    if (stopped || !el) return;
    ticks += 1;
    lastTickAt = Date.now();
    stallWarned = false;
    setState({
      position: finite(el.currentTime),
      duration: finite(el.duration),
      playing: !el.paused,
      seeking: state.seeking,
    });
  };

  const onSeeking = () => {
    if (stopped || !el) return;
    lastTickAt = Date.now();
    stallWarned = false;
    setState({ ...state, seeking: true });
  };

  const onSeeked = () => {
    if (stopped || !el) return;
    ticks += 1;
    lastTickAt = Date.now();
    stallWarned = false;
    setState({
      position: finite(el.currentTime),
      duration: finite(el.duration),
      playing: !el.paused,
      seeking: false,
    });
  };

  const detach = () => {
    if (!el) return;
    const prev = el;
    if (rvfcHandle != null && typeof prev.cancelVideoFrameCallback === 'function') {
      try { prev.cancelVideoFrameCallback(rvfcHandle); } catch (_) { /* ignore */ }
    }
    rvfcHandle = null;
    TICK_EVENTS.forEach((ev) => {
      if (ev === 'seeked') return;
      try { prev.removeEventListener(ev, tick); } catch (_) { /* ignore */ }
    });
    try { prev.removeEventListener('seeked', onSeeked); } catch (_) { /* ignore */ }
    try { prev.removeEventListener('seeking', onSeeking); } catch (_) { /* ignore */ }
    el = null;
    driver = null;
  };

  const attach = (next) => {
    el = next;
    TICK_EVENTS.forEach((ev) => {
      if (ev === 'seeked') return;
      next.addEventListener(ev, tick);
    });
    next.addEventListener('seeked', onSeeked);
    next.addEventListener('seeking', onSeeking);

    const hasRvfc = typeof next.requestVideoFrameCallback === 'function';
    driver = hasRvfc ? 'rvfc' : 'timeupdate';
    if (hasRvfc) {
      const frame = () => {
        if (stopped || el !== next) return;
        tick();
        rvfcHandle = next.requestVideoFrameCallback(frame);
      };
      rvfcHandle = next.requestVideoFrameCallback(frame);
    }

    lastTickAt = Date.now();
    stallWarned = false;
    logger().debug?.('surround.clock.driver', { contentId, driver });
    tick();
  };

  /** Re-resolve the element; attach/detach/swap as needed. Never throws. */
  const sync = () => {
    if (stopped) return;
    let next = null;
    try { next = typeof getMediaEl === 'function' ? getMediaEl() : null; } catch (_) { next = null; }
    if (next === el) return;
    detach();
    if (next) attach(next);
    else setState({ ...ZERO_STATE });
  };

  const checkHealth = (now) => {
    if (!windowStart) { windowStart = now; return; }
    const elapsed = now - windowStart;
    if (elapsed < HEALTH_WINDOW_MS) return;
    const secs = elapsed / 1000;
    logger().sampled?.('surround.clock.health', {
      contentId,
      driver,
      ticksPerSec: +(ticks / secs).toFixed(1),
      sampledHz: +(reactSamples / secs).toFixed(1),
    }, { maxPerMinute: 1, aggregate: false });
    windowStart = now;
    ticks = 0;
    reactSamples = 0;
  };

  const checkStall = (now) => {
    if (!el || !state.playing || stallWarned) return;
    const since = now - lastTickAt;
    if (since < STALL_MS) return;
    stallWarned = true;
    logger().warn?.('surround.clock.stalled', {
      contentId, driver, sinceLastTickMs: Math.round(since), position: state.position,
    });
  };

  const start = () => {
    if (running || stopped) return;
    running = true;
    windowStart = Date.now();
    sync();
    supervisor = setInterval(() => {
      const now = Date.now();
      sync();
      checkStall(now);
      checkHealth(now);
    }, SUPERVISOR_MS);
  };

  const stop = () => {
    stopped = true;
    running = false;
    if (supervisor) { clearInterval(supervisor); supervisor = null; }
    detach();
    subscribers.clear();
  };

  return {
    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getState: () => state,
    /** Counted into `surround.clock.health.sampledHz` by the React sampler. */
    recordReactSample: () => { reactSamples += 1; },
    start,
    stop,
  };
}

/**
 * React binding for the clock. The returned handle is stable for the lifetime of
 * the component, so consumers can subscribe once without churn.
 *
 * @param {{ getMediaEl: () => (HTMLMediaElement|null), contentId?: string }} opts
 * @returns {{ subscribe: (cb: Function) => Function, getState: () => object }}
 */
export function useMediaClock({ getMediaEl, contentId = null } = {}) {
  // Keep the latest accessor in a ref so an inline `() => ref.current` arrow from
  // the caller never tears down and re-attaches the driver.
  const getElRef = useRef(getMediaEl);
  getElRef.current = getMediaEl;

  const clockRef = useRef(null);
  if (!clockRef.current) {
    clockRef.current = createMediaClock({
      getMediaEl: () => (typeof getElRef.current === 'function' ? getElRef.current() : null),
      contentId,
    });
  }

  useEffect(() => {
    const clock = clockRef.current;
    clock.start();
    return () => clock.stop();
  }, []);

  return clockRef.current;
}

/**
 * Sample the clock into React state at `hz` (default 10). Position/duration are
 * throttled; `playing` / `seeking` transitions commit immediately because they are
 * discrete and a late one reads as a bug. A trailing flush guarantees the final
 * tick of a burst always lands, so the cursor never parks one window short.
 *
 * @param {{ getMediaEl: () => (HTMLMediaElement|null), contentId?: string, hz?: number }} opts
 * @returns {{ position: number, duration: number, playing: boolean, seeking: boolean }}
 */
export function useMediaClockState({ getMediaEl, contentId = null, hz = 10 } = {}) {
  const clock = useMediaClock({ getMediaEl, contentId });
  const [snapshot, setSnapshot] = useState(ZERO_STATE);

  // Mirror of the committed snapshot, read inside the subscriber without making the
  // subscription depend on it (which would resubscribe on every commit).
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const minIntervalMs = useMemo(() => {
    const rate = typeof hz === 'number' && hz > 0 ? hz : 10;
    return 1000 / rate;
  }, [hz]);

  useEffect(() => {
    let lastCommitAt = 0;
    let trailing = null;
    let last = clock.getState();

    const commit = (s) => {
      lastCommitAt = Date.now();
      clock.recordReactSample?.();
      setSnapshot(s);
    };

    const onTick = (s) => {
      last = s;
      const discreteChanged = s.playing !== snapshotRef.current.playing
        || s.seeking !== snapshotRef.current.seeking;
      const due = Date.now() - lastCommitAt >= minIntervalMs;
      if (discreteChanged || due) {
        if (trailing) { clearTimeout(trailing); trailing = null; }
        commit(s);
        return;
      }
      if (!trailing) {
        const wait = Math.max(0, minIntervalMs - (Date.now() - lastCommitAt));
        trailing = setTimeout(() => { trailing = null; commit(last); }, wait);
      }
    };

    const unsubscribe = clock.subscribe(onTick);
    commit(clock.getState());
    return () => {
      unsubscribe();
      if (trailing) clearTimeout(trailing);
    };
  }, [clock, minIntervalMs]);

  return snapshot;
}

export default useMediaClockState;
