/**
 * Explicit cleanup for <dash-video> web component on unmount.
 * Firefox has lower SourceBuffer quotas than Chrome; without explicit cleanup,
 * orphaned buffers from rapid remount cycles accumulate to a fixed ceiling.
 *
 * This function is the ONLY thing that tears a dash.js MediaPlayer down —
 * `dash-video-element` ships no `disconnectedCallback`, so an element that
 * leaves the tree without passing through here keeps fetching audio segments
 * forever. On 2026-08-16 two of those survivors delivered the same lecture's
 * audio 86ms apart and a child heard it doubled. The old version of this file
 * swallowed four exceptions and took two early returns without a word, so the
 * scenario its own docstring described could happen at full volume and leave
 * no trace. Hence the outcome event below: every call says what it managed to
 * release, and a failure says so under its own event name.
 *
 * Contract: this runs inside React cleanup. It must never throw. Every step is
 * guarded on its own, so one failure does not cancel the steps after it — the
 * `pause()` throw used to skip `removeAttribute('src')` and `load()`, which are
 * the two calls that actually stop the fetching.
 */

import { getLogger } from '../../../lib/logging/Logger.js';

// Module-level lazy child logger (the convention in CLAUDE.md for non-component
// code): resolving it at import time races the logger's own configuration.
let _logger;
const log = () => {
  if (!_logger) _logger = getLogger().child({ component: 'dash-cleanup' });
  return _logger;
};

// Running totals for the tab. A rising `failed` against `attempted` IS the
// leak — read them with getDashCleanupCounters() from a console or a probe.
let cleanupsAttempted = 0;
let cleanupsFailed = 0;
let cleanupsCleaned = 0;
let cleanupsNoOp = 0;
let firstFailureReported = false;

/**
 * Snapshot of the tab's cleanup accounting.
 * @returns {{attempted:number, failed:number, cleaned:number, noOp:number, noElement:number}}
 */
export function getDashCleanupCounters() {
  return {
    attempted: cleanupsAttempted,
    failed: cleanupsFailed,
    cleaned: cleanupsCleaned,
    noOp: cleanupsNoOp,
    noElement: cleanupsAttempted - cleanupsFailed - cleanupsCleaned - cleanupsNoOp
  };
}

/** Test-only: the counters are process-lifetime state, so tests must zero them. */
export function _resetDashCleanupCountersForTests() {
  cleanupsAttempted = 0;
  cleanupsFailed = 0;
  cleanupsCleaned = 0;
  cleanupsNoOp = 0;
  firstFailureReported = false;
}

/**
 * The scheme of the media element's `src`, as a closed vocabulary so that each
 * kind of absence names itself: 'no-media-el' (we never got to read one),
 * 'unreadable' (the property access threw), 'empty' (present and blank),
 * 'relative' (no scheme at all), or the lowercased scheme.
 */
const KNOWN_SCHEMES = ['blob', 'data', 'http', 'https', 'file', 'mediasource'];
const readSrcScheme = (mediaEl) => {
  let raw;
  try {
    raw = mediaEl.src;
  } catch (_) {
    return 'unreadable';
  }
  if (typeof raw !== 'string' || raw === '') return 'empty';
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (!match) return 'relative';
  const scheme = match[1].toLowerCase();
  return KNOWN_SCHEMES.includes(scheme) ? scheme : 'other';
};

const emitOutcome = (report) => {
  if (report.outcome === 'failed') cleanupsFailed += 1;
  else if (report.outcome === 'cleaned') cleanupsCleaned += 1;
  else if (report.outcome === 'no-op') cleanupsNoOp += 1;

  try {
    // The running totals ride along so a single log line answers "how bad is
    // this". Note the framework's `.aggregated` roll-up SUMS numeric fields, so
    // the totals in that line are sums of snapshots — getDashCleanupCounters()
    // is the authority. The roll-up's own value here is its per-value tally of
    // the string `outcome`, which is the failure rate directly.
    const payload = { ...report, cleanupsAttempted, cleanupsFailed };

    if (report.outcome === 'failed') {
      // One un-rate-limited warn for the first failure of the process. A leak
      // that starts at minute one should not have to win a sampling budget to
      // be noticed; every failure after it is counted, not narrated.
      if (!firstFailureReported) {
        firstFailureReported = true;
        log().warn('dash-cleanup.first-failure', payload);
      }
      // Separate event name = separate sampling budget, so a storm of ordinary
      // cleanups cannot crowd the failures out of the log.
      log().sampled('dash-cleanup.failed', payload, { maxPerMinute: 30, aggregate: true });
    } else {
      log().sampled('dash-cleanup.outcome', payload, { maxPerMinute: 20, aggregate: true });
    }
  } catch (_) {
    // Reporting a cleanup must never be the thing that breaks a cleanup.
  }
};

/**
 * Tear down a <dash-video> element's dash.js MediaPlayer and release its inner
 * media element. Safe (and a documented no-op) on a native <video>.
 *
 * Emits exactly one outcome event per call:
 *   'cleaned'    — the inner media element was found and released.
 *   'no-op'      — nothing to tear down: no api, no destroy/reset, no shadow
 *                  root. This is what a native <video> generation looks like,
 *                  and it is NOT counted as a failure.
 *   'failed'     — something threw, or the element looked like a dash wrapper
 *                  and its inner media element could not be reached. This is
 *                  the leak: the element keeps fetching segments.
 *   'no-element' — called with nothing at all (the ref was already null).
 *
 * @param {Element|null|undefined} el
 */
export function cleanupDashElement(el) {
  cleanupsAttempted += 1;

  const errors = [];
  const noteError = (step, error) => {
    errors.push(`${step}: ${error && error.message ? error.message : String(error)}`);
  };

  const report = {
    // Whether a callable `el.api.destroy` existed at all.
    hadApi: false,
    // true = destroy ran, false = destroy threw, null = not attempted (hadApi false).
    apiDestroyOk: null,
    // Which fallback the web component itself offered: 'destroy' | 'reset' | 'none'.
    componentTeardown: 'none',
    // true/false as above; null = not attempted (componentTeardown === 'none').
    componentDestroyOk: null,
    // How the inner media element lookup went — each absence named:
    // 'found' | 'no-shadow-root' | 'shadow-root-empty' | 'lookup-threw' | 'no-element'.
    mediaElLookup: 'no-element',
    foundMediaEl: false,
    // true/false; null = no media element to pause.
    pauseOk: null,
    // true = a blob: src was revoked, false = revoke threw, null = no blob src.
    blobRevoked: null,
    srcScheme: 'no-media-el',
    // removeAttribute('src') + load(): the calls that actually stop the fetching.
    releaseOk: null,
    outcome: 'no-element',
    // Joined "step: message" for everything that threw; null = nothing threw.
    error: null
  };

  if (!el) {
    emitOutcome(report);
    return;
  }

  // Destroy the dash.js MediaPlayer instance first — this is what owns
  // the MediaSource and SourceBuffers. Without this, orphaned buffers
  // keep polling and throwing InvalidStateError after the element is removed.
  try {
    if (el.api && typeof el.api.destroy === 'function') {
      report.hadApi = true;
      el.api.destroy();
      report.apiDestroyOk = true;
    }
  } catch (error) {
    report.apiDestroyOk = false;
    noteError('api-destroy', error);
  }

  // Try web component's own destroy/reset method as fallback
  try {
    if (typeof el.destroy === 'function') {
      report.componentTeardown = 'destroy';
      el.destroy();
      report.componentDestroyOk = true;
    } else if (typeof el.reset === 'function') {
      report.componentTeardown = 'reset';
      el.reset();
      report.componentDestroyOk = true;
    }
  } catch (error) {
    report.componentDestroyOk = false;
    noteError(`component-${report.componentTeardown}`, error);
  }

  // Access inner <video> via shadow DOM and clean up. A native <video> has no
  // shadow root, which is why 'no-shadow-root' is a distinct outcome from
  // 'shadow-root-empty' — the first is a legitimate no-op, the second is a dash
  // wrapper whose inner element we failed to reach, i.e. one that keeps pulling.
  let mediaEl = null;
  try {
    if (!el.shadowRoot) {
      // A native <video> IS the media element — it has no shadow root to look
      // into. VideoPlayer renders the dash and native branches under the SAME
      // containerRef and the SAME dashElementKey, so this cleanup runs for both,
      // and treating 'no shadow root' as a plain no-op left a replaced native
      // element playing on with no DOM node and no controls bound to it. That is
      // the 2026-08-16 "audio from nowhere" report. Resolve to the element
      // itself when it is pausable; a genuinely non-media container still falls
      // through as a no-op.
      mediaEl = typeof el.pause === 'function' ? el : null;
      report.mediaElLookup = mediaEl ? 'native-element' : 'no-shadow-root';
    } else {
      mediaEl = el.shadowRoot.querySelector('video, audio');
      report.mediaElLookup = mediaEl ? 'found' : 'shadow-root-empty';
    }
  } catch (error) {
    report.mediaElLookup = 'lookup-threw';
    noteError('media-el-lookup', error);
  }
  report.foundMediaEl = !!mediaEl;

  if (mediaEl) {
    try {
      mediaEl.pause();
      report.pauseOk = true;
    } catch (error) {
      report.pauseOk = false;
      noteError('pause', error);
    }

    // Revoke blob URL if present (before clearing src)
    report.srcScheme = readSrcScheme(mediaEl);
    if (report.srcScheme === 'blob') {
      try {
        URL.revokeObjectURL(mediaEl.src);
        report.blobRevoked = true;
      } catch (error) {
        report.blobRevoked = false;
        noteError('revoke-object-url', error);
      }
    }

    // W3C-recommended resource release pattern. Guarded on its own so a failed
    // pause() above can no longer skip it — these two calls are the ones that
    // stop the segment fetching.
    try {
      mediaEl.removeAttribute('src');
      mediaEl.load();
      report.releaseOk = true;
    } catch (error) {
      report.releaseOk = false;
      noteError('release', error);
    }
  }

  report.error = errors.length ? errors.join(' | ') : null;

  if (errors.length) {
    report.outcome = 'failed';
  } else if (report.foundMediaEl && report.releaseOk === true) {
    report.outcome = 'cleaned';
  } else if (!report.hadApi && report.componentTeardown === 'none' && report.mediaElLookup === 'no-shadow-root') {
    // Nothing dash-shaped about this element: a native <video> generation.
    report.outcome = 'no-op';
  } else {
    // It looked like a dash wrapper and we never reached its media element.
    report.outcome = 'failed';
  }

  emitOutcome(report);
}
