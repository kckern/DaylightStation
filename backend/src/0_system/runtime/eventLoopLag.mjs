// backend/src/0_system/runtime/eventLoopLag.mjs
//
// Samples perf_hooks.monitorEventLoopDelay and reports how late the event loop
// was over each window.
//
// WHY THIS EXISTS
// ---------------
// On 2026-09-01 (16:49:26–16:50:09 UTC) every in-flight request from the
// living-room TV hung and then released in one ~200 ms burst: a Plex byte-range
// proxy at durationMs=45650, two content resolves at 30.9 s and 14.8 s, and six
// `POST /log` calls at 8–43 s. `POST /log` has no upstream and does no I/O
// beyond the log store, so whatever stalled sat between the socket and our
// handlers — not inside Plex. Two hypotheses survive and look identical from
// outside the process:
//
//   1. the backend's event loop stalled, so nothing was serviced; or
//   2. the LAN hiccuped, and two kiosks on two radios degraded together.
//
// From inside they are not alike at all. A loop stall means timers fire late;
// a network stall leaves the loop idle and punctual. Nothing measured that, so
// the incident closed unexplained. This measures it.
//
// WHAT THE EXISTING DATA ALREADY SHOWS
// ------------------------------------
// The self-memory watchdog in serverMain.mjs is a 5-minute setInterval, so the
// overshoot of each of its gaps beyond 300 s is a crude sample of loop lateness.
// Over 2026-09-01 12:08–20:04 UTC, comparing only consecutive fires from the
// same container (three container restarts in the window otherwise fake large
// gaps), 90 intervals gave: p50 +0.030 s, p90 +0.31 s, max +15.13 s, with five
// fires late by >1 s and two by >10 s. So this process does stall for seconds
// at a time, several times a day at minimum.
//
// That undercounts badly. A 300 s timer only notices a stall that happens to
// span its due instant, so it catches roughly D/300 of stalls of duration D —
// about 3% of a 10 s stall, 15% of a 45 s one. Two observed >10 s stalls in 90
// intervals implies the process spends on the order of 2% of its life with the
// loop blocked >10 s. It also means the incident is NOT exonerated by the
// watchdog firing on time at 16:53:46 (+0.03 s): the stall ended at 16:50:09,
// three and a half minutes before that timer was due, so an on-time fire is
// exactly what a 45 s loop stall would have produced anyway.
//
// A 20 ms histogram sees every stall instead of a few percent of them.
//
// HOW TO READ THE OUTPUT
// ----------------------
// `system.event-loop.lag` is emitted once per window at info, escalating to
// warn at/above thresholdMs — the same shape as the `server.memory` watchdog it
// sits beside. Logging the quiet windows too is deliberate: it makes "the loop
// was healthy" a positive record rather than an absence (a gap in these rows
// means the process was down or not shipping, which is itself the answer), and
// it is the only way to learn this box's real baseline and retune thresholdMs
// from data instead of from a guess.
//
//   maxMs    worst single delay in the window — the stall itself.
//   p50Ms    typical delay. A big maxMs with a ~0 p50Ms is one discrete block
//            (a synchronous call, a full GC). A big maxMs with an elevated
//            p50Ms is sustained starvation — the process not getting CPU,
//            e.g. contention with a transcode on the same host.
//   p99Ms    the tail, for spotting degradation before it becomes an outage.
//   windowMs wall clock the window actually took. This is a second, independent
//            witness that does not use the histogram at all: our own timer is
//            late by however long the loop was blocked, so a 60 s window that
//            closed after 105 s says the process could not run for ~45 s.
//
// An idle loop does not report zero: every figure bottoms out at the sampling
// resolution, so a healthy row reads maxMs/p99Ms/p50Ms ≈ 20, not 0. Measured
// against a real histogram, a deliberate 900 ms block produced maxMs=916,
// p50Ms=21, windowMs=1052 on a nominal 300 ms window, while the windows either
// side of it sat flat at 21 — the sample() that reported it ran 2 ms after the
// block ended, never during it, which is why a stall is always recorded in the
// window it finishes in rather than lost.
//
// Applied to the incident, the two hypotheses now separate cleanly: a loop
// stall writes one row near 16:50:09 with maxMs ≈ 45000 and windowMs ≈ 105000;
// a network stall writes an ordinary row (maxMs in the tens of ms, windowMs
// ≈ 60000) while the http.response durations still read 45 s.
//
// What it still cannot do: attribute. It says the loop was blocked, not by
// what, and it cannot separate "our JS blocked" from "the OS descheduled us"
// or "GC paused us" — all three are the process failing to run. That is enough
// to decide backend-vs-network, which is the open question, and correlation
// with request rows is by timestamp only, since nothing request-scoped is
// visible at this layer.
import { monitorEventLoopDelay } from 'node:perf_hooks';

export const EVENT_LAG = 'system.event-loop.lag';
export const EVENT_MONITOR_STARTED = 'system.event-loop.monitor-started';

/** Histogram sampling period. Bounds the smallest delay we can resolve. */
export const DEFAULT_RESOLUTION_MS = 20;

/**
 * One minute per window. Long enough that p99 is drawn from ~3000 samples and
 * means something (a 5 s window offers ~250, where p99 is just the third-worst
 * reading and is noise); short enough to line a row up against an incident
 * timeline, and to show whether the loop was sick for one minute or ten.
 */
export const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Warn at a second. Well under the 45 s incident and well over the +0.31 s p90
 * measured above, but the measured tail says warns will not be rare — retune
 * from the info rows once there is a week of them.
 */
export const DEFAULT_THRESHOLD_MS = 1000;

const toMs = (ns) => Math.round(ns / 1e6);

export function createEventLoopLagMonitor({
  logger,
  histogram = monitorEventLoopDelay({ resolution: DEFAULT_RESOLUTION_MS }),
  thresholdMs = DEFAULT_THRESHOLD_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = () => Date.now(),
} = {}) {
  let timer = null;
  let windowOpenedAt = now();

  // Declared as a plain function rather than reached through `this`, so a
  // detached `const { start } = monitor` cannot silently lose its receiver.
  function sample() {
    const closedAt = now();
    const maxMs = toMs(histogram.max);
    const data = {
      maxMs,
      p99Ms: toMs(histogram.percentile(99)),
      p50Ms: toMs(histogram.percentile(50)),
      windowMs: closedAt - windowOpenedAt,
      thresholdMs,
    };
    // Same escalation shape as the server.memory watchdog: always on the
    // record, loud only when it matters.
    logger?.[maxMs >= thresholdMs ? 'warn' : 'info']?.(EVENT_LAG, data);
    histogram.reset();
    windowOpenedAt = closedAt;
  }

  function start() {
    if (timer) return;
    histogram.enable?.();
    windowOpenedAt = now();
    timer = setInterval(sample, intervalMs);
    // Never keep the process alive for the sake of measuring it.
    timer.unref?.();
    logger?.info?.(EVENT_MONITOR_STARTED, {
      thresholdMs,
      intervalMs,
    });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    histogram.disable?.();
  }

  return { sample, start, stop };
}
