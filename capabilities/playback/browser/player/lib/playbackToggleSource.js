/**
 * Source tagging for `playback.paused` / `playback.resumed` telemetry.
 *
 * In the 2026-05-23 fitness session (`fs_20260523132554`), the media
 * element emitted 8 alternating pause/resume events in 3.4 seconds at
 * the same currentTime. dash.js's internal retry loop and the user's
 * play press were indistinguishable in the log because the controller
 * only listened to the DOM `pause` and `play` events.
 *
 * These helpers mirror the existing `__seekSource` pattern (see
 * `useCommonMediaController.js:382, 1313`): app code that intentionally
 * pauses/plays the element tags the source immediately before the call;
 * the pause/play event handler reads-and-clears the tag and includes the
 * source in the log payload. Untagged calls (dash.js internal retries,
 * browser auto-pause on `waiting`) read as `'dom-event'`.
 *
 * Bug ref: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §3
 */

const PAUSE_KEY = '__pauseSource';
const PLAY_KEY = '__playSource';
const DEFAULT_SOURCE = 'dom-event';

const normalize = (value) => {
  if (value === undefined || value === null) return null;
  const str = String(value);
  return str.length > 0 ? str : null;
};

const tag = (el, key, source) => {
  if (!el) return;
  const normalized = normalize(source);
  if (normalized === null) return;
  try {
    el[key] = normalized;
  } catch (_) { /* element rejected the property; swallow */ }
};

const readAndClear = (el, key) => {
  if (!el) return DEFAULT_SOURCE;
  const raw = el[key];
  const normalized = normalize(raw);
  if (normalized === null) return DEFAULT_SOURCE;
  try { delete el[key]; } catch (_) { /* ignore */ }
  return normalized;
};

export function tagPauseSource(el, source) { tag(el, PAUSE_KEY, source); }
export function tagPlaySource(el, source) { tag(el, PLAY_KEY, source); }
export function readAndClearPauseSource(el) { return readAndClear(el, PAUSE_KEY); }
export function readAndClearPlaySource(el) { return readAndClear(el, PLAY_KEY); }
