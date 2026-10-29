/**
 * bufferProgress — tell "slow link, buffer is growing" from "stuck".
 *
 * 2026-10-28: a piano lesson (direct-play mp4) stalled 19 times in 7 minutes
 * because the tablet's Wi-Fi delivered ~0.3x realtime. Every stall armed the
 * jolt ladder, whose rungs re-mint the URL and reload the element — i.e. they
 * threw away what had downloaded and restarted the request on the same slow
 * link, which made it worse (9 jolts, 4 softReinits, then exhaustion).
 *
 * A starved playhead whose buffered end is still moving forward is a link that
 * is slow, not a stream that is dead: the right move is to wait for buffer and
 * say so on screen. Only a buffer that has stopped growing (or an element that
 * is frozen with plenty buffered, or a media error) is "stuck" and deserves the
 * ladder. Pure (no DOM/React) so the thresholds are unit-tested.
 *
 * Bug ref: ops:docs/_wip/bugs/2026-10-28-piano-lesson-video-stalls.md
 */

// Window over which buffer growth is measured. Must fit inside the jolt ladder's
// grace (STALL_JOLT_GRACE_MS) so the verdict is ready before the first rung.
export const SLOW_LINK_WINDOW_MS = 6000;
// Media seconds the buffer must gain inside the window to count as "growing"
// (0.5s / 6s ≈ 0.08x realtime). Below that a re-request has nothing to lose.
export const SLOW_LINK_MIN_GROWTH_SEC = 0.5;
// Seconds buffered ahead of a frozen playhead past which the element — not the
// link — is the problem (a decoder/pipeline wedge the ladder exists for; a
// progressive download keeps going while the decoder is wedged). Chromium
// resumes a starved element with well under this buffered (the 2026-10-28
// stalls resumed after 1–5 s of content), so 5 s is slack, not a target. With
// the growth floor this also bounds a hold: growing ≥0.5 s per 6 s, a frozen
// playhead passes 5 s ahead within ~60 s.
export const SLOW_LINK_FROZEN_AHEAD_SEC = 5;
// Backstop: longest one stall episode may be held as "slow link" before the
// ladder is allowed one refresh anyway (a server-side trickle can look like a
// slow link). The frozen-ahead mark normally ends a buffered hold first; this
// is what bounds a pre-metadata (readyState 0) hold.
export const SLOW_LINK_MAX_HOLD_MS = 120_000;
// HAVE_FUTURE_DATA: the element has data past the playhead. Still frozen at
// the first rung (≥9.5 s stuck) means the pipeline, not the link, is stuck.
const HAVE_FUTURE_DATA = 3;
// A playhead move larger than this between two samples is a seek or element
// swap: the buffered end jumps with it, and that jump is not download progress.
const PLAYHEAD_JUMP_SEC = 3;
// Tolerance for a playhead resting a hair before its range (seek landing).
const RANGE_SLACK_SEC = 0.25;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Read the buffer around the playhead.
 * @returns {{currentTime:number|null, bufferAheadSec:number|null, bufferedEndSec:number|null,
 *           readyState:number|null, networkState:number|null}}
 */
export function readBufferWindow(el) {
  const out = { currentTime: null, bufferAheadSec: null, bufferedEndSec: null, readyState: null, networkState: null };
  if (!el) return out;
  try {
    out.readyState = num(el.readyState);
    out.networkState = num(el.networkState);
    const ct = num(el.currentTime);
    out.currentTime = ct;
    if (ct == null) return out;
    const ranges = el.buffered;
    const count = Number(ranges?.length) || 0;
    for (let i = 0; i < count; i += 1) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (Number.isFinite(start) && Number.isFinite(end) && ct >= start - RANGE_SLACK_SEC && ct <= end) {
        out.bufferedEndSec = end;
        out.bufferAheadSec = Math.max(0, end - ct);
        return out;
      }
    }
    out.bufferedEndSec = ct;
    out.bufferAheadSec = 0;
  } catch (_) {
    out.bufferAheadSec = null;
    out.bufferedEndSec = null;
  }
  return out;
}

/**
 * Rolling record of the buffered end, so "is the download moving?" can be
 * answered at any moment. sample() takes a readBufferWindow() result.
 */
export function createBufferGrowthTracker({ windowMs = SLOW_LINK_WINDOW_MS } = {}) {
  let samples = []; // { ts, growth }
  let prev = null;  // last usable reading { currentTime, bufferedEndSec }
  let lastGrowthAtMs = null;

  const prune = (now) => { samples = samples.filter((s) => now - s.ts <= windowMs); };

  return {
    sample(now, reading) {
      const ct = num(reading?.currentTime);
      const end = num(reading?.bufferedEndSec);
      if (ct == null || end == null) return;
      let growth = 0;
      if (prev && Math.abs(ct - prev.currentTime) <= PLAYHEAD_JUMP_SEC) {
        growth = Math.max(0, end - prev.bufferedEndSec);
      } else if (prev) {
        lastGrowthAtMs = null; // new position: earlier growth says nothing about it
        samples = [];
      }
      if (growth > 0.01) lastGrowthAtMs = now;
      prev = { currentTime: ct, bufferedEndSec: end };
      samples.push({ ts: now, growth });
      prune(now);
    },
    snapshot(now) {
      prune(now);
      if (!samples.length) return { growthSec: 0, spanMs: 0, ratePerSec: null, lastGrowthAtMs, samples: 0 };
      const growthSec = samples.reduce((a, s) => a + s.growth, 0);
      const spanMs = now - samples[0].ts;
      return {
        growthSec: Math.round(growthSec * 1000) / 1000,
        spanMs,
        ratePerSec: spanMs > 0 ? Math.round((growthSec / (spanMs / 1000)) * 1000) / 1000 : null,
        lastGrowthAtMs,
        samples: samples.length,
      };
    },
    reset() { samples = []; prev = null; lastGrowthAtMs = null; },
  };
}

/**
 * Verdict for a stuck episode.
 * @returns {{kind:'slow-link'|'stuck', reason:string}}
 */
export function decideStuckKind({ now, reading, growth, hasMediaError = false, holdStartedAtMs = null, networkProgressAtMs = null }) {
  if (hasMediaError) return { kind: 'stuck', reason: 'media-error' };
  if (num(holdStartedAtMs) != null && now - holdStartedAtMs > SLOW_LINK_MAX_HOLD_MS) {
    return { kind: 'stuck', reason: 'slow-link-hold-expired' };
  }
  // Before metadata (readyState 0) there is no buffered range to measure, so a
  // reload that is still fetching the header (an mp4 moov can be megabytes) is
  // judged by the element's own `progress` events — fired only when bytes
  // actually arrived. Re-requesting it would restart the header from zero.
  if (reading && reading.readyState === 0) {
    const fetching = num(networkProgressAtMs) != null && now - networkProgressAtMs <= SLOW_LINK_WINDOW_MS;
    return fetching ? { kind: 'slow-link', reason: 'metadata-loading' } : { kind: 'stuck', reason: 'no-download-progress' };
  }
  if (!reading || !growth || num(reading.bufferAheadSec) == null) return { kind: 'stuck', reason: 'no-reading' };
  if (reading.bufferAheadSec >= SLOW_LINK_FROZEN_AHEAD_SEC) return { kind: 'stuck', reason: 'buffered-but-frozen' };
  if (num(reading.readyState) != null && reading.readyState >= HAVE_FUTURE_DATA) return { kind: 'stuck', reason: 'ready-but-frozen' };
  const recent = num(growth.lastGrowthAtMs) != null && now - growth.lastGrowthAtMs <= SLOW_LINK_WINDOW_MS;
  if (!recent || !(growth.growthSec >= SLOW_LINK_MIN_GROWTH_SEC)) return { kind: 'stuck', reason: 'no-download-progress' };
  return { kind: 'slow-link', reason: 'buffer-growing' };
}

/** Browser's own link estimate (Network Information API), when it has one. */
export function readConnectionInfo(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  const c = nav?.connection;
  if (!c) return null;
  return {
    effectiveType: c.effectiveType ?? null,
    downlinkMbps: num(c.downlink),
    rttMs: num(c.rtt),
    saveData: c.saveData === true,
  };
}
