/**
 * Pure decision function for dash.js error recovery.
 *
 * In the 2026-05-23 fitness session (`fs_20260523132554`), a Plex
 * transcode session that had been alive 10 minutes pre-workout got
 * reaped by Plex's idle timer. dash.js fired error 27 (segment
 * unavailable) then 28 (init segment / header unavailable) repeatedly.
 * The existing `useMediaResilience.hardReset({ refreshUrl: true })`
 * mechanism — which mutates the <dash-video> `src` so the backend
 * mints a fresh Plex transcode session — exists and is tested, but
 * the dash error handler did not call it. User had to manually close
 * + restart the player.
 *
 * Returns `{ action: 'refresh-url', reason }` for the two specific
 * error codes that signal "the source URL is dead, please re-fetch",
 * up to `maxAttempts` times per mount. All other error codes return
 * `{ action: 'ignore' }` so the existing nudge/reload pipeline
 * still owns them (those are mid-stream decode/network errors, not
 * source-URL errors).
 *
 * Bug ref: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §2
 */

const SEGMENT_UNAVAILABLE = 27;          // dash.js MEDIA_ERR_DECODE or fragment 404
const INIT_OR_MANIFEST_UNAVAILABLE = 28; // dash.js manifest loader / init segment loader

export function decideDashErrorRecovery({ errorCode, attemptsThisMount, maxAttempts = 3 }) {
  if (errorCode !== SEGMENT_UNAVAILABLE && errorCode !== INIT_OR_MANIFEST_UNAVAILABLE) {
    return { action: 'ignore', reason: 'not-a-source-url-error' };
  }
  if (attemptsThisMount >= maxAttempts) {
    return { action: 'ignore', reason: 'refresh-budget-exhausted' };
  }
  const reasonByCode = {
    [SEGMENT_UNAVAILABLE]: 'segment-unavailable',
    [INIT_OR_MANIFEST_UNAVAILABLE]: 'init-or-manifest-unavailable'
  };
  return { action: 'refresh-url', reason: reasonByCode[errorCode] };
}
