/**
 * `playback.at-duration-stuck` telemetry helpers.
 *
 * `useCommonMediaController.scheduleStallDetection` has a near-end guard:
 *
 *     if (s.hasEnded || mediaEl.ended ||
 *         (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
 *       // skip stall detection near end
 *     }
 *
 * In the 2026-05-23 incident, that guard silently disengaged stall recovery
 * while the screens player was paused at duration with `mediaEl.ended ===
 * false` — leaving the user with a stuck "Seeking…" overlay for 87 seconds.
 *
 * `shouldLogAtDurationStuck` returns true when the guard activates due to
 * the near-end branch (not a legitimate `ended` event). The caller is
 * expected to emit `playback.at-duration-stuck` exactly once per arming
 * episode, gated by an `alreadyLogged` flag the caller maintains.
 *
 * See: docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md §2.2
 */
import { isNearEnd } from './nearEnd.js';

export function shouldLogAtDurationStuck({ hasEnded, mediaEl, alreadyLogged }) {
  if (alreadyLogged) return false;
  if (hasEnded) return false;
  if (!mediaEl) return false;
  if (mediaEl.ended) return false;
  return isNearEnd(mediaEl.currentTime, mediaEl.duration);
}

export function buildAtDurationStuckPayload({ assetId, mediaEl }) {
  return {
    mediaKey: assetId,
    currentTime: mediaEl.currentTime,
    duration: mediaEl.duration,
    paused: mediaEl.paused,
    seeking: mediaEl.seeking,
    readyState: mediaEl.readyState,
    networkState: mediaEl.networkState
  };
}
