/**
 * Source availability — pure rules for "the media server refused the file".
 *
 * On 2026-09-28 the NAS behind Plex zeroed the mode on thousands of Fitness
 * files in a transient burst. Plex answered every direct-play request for them
 * with 404, the <video> element raised MediaError code 4, and the recovery
 * ladder spent its five attempts reloading a URL that could not work, then
 * parked on "Tap to Retry" mid-workout.
 *
 * A refused source is not a stall. Reloading cannot fix it; only the file
 * becoming readable again can. So the Player asks the backend
 * (`POST api/v1/media-source/check`, which also runs a repair ladder), and while
 * the answer is `unreadable` it WAITS — no recovery attempts, no ledger spend —
 * polling with backoff, then reloads once, at the saved position, the moment
 * the file is readable. See docs/reference/player/media-source-healing.md.
 */

/**
 * MEDIA_ERR_NETWORK (2) and MEDIA_ERR_SRC_NOT_SUPPORTED (4) are what Chromium
 * raises for an HTTP failure on a direct-play `src`, with the upstream status
 * leading the message ("404: Not Found"). 503 is what the Plex proxy answers
 * once its own retries give up (`source-unreadable`).
 */
const REFUSAL_ERROR_CODES = Object.freeze([2, 4]);
const REFUSAL_MESSAGE = /^\s*(403|404|503)\b|source-unreadable/i;

export function isSourceRefusal({ errorCode, errorMessage } = {}) {
  if (!REFUSAL_ERROR_CODES.includes(errorCode)) return false;
  return REFUSAL_MESSAGE.test(String(errorMessage ?? ''));
}

/** Only Plex files go through the healer: `plex:123` or a bare rating key. */
export function toHealableContentId(contentId, plexId = null) {
  const raw = contentId ?? (plexId != null ? `plex:${plexId}` : null);
  const match = /^(?:plex:)?(\d+)$/.exec(String(raw ?? '').trim());
  return match ? `plex:${match[1]}` : null;
}

const POLL_DELAYS_MS = Object.freeze([2_000, 4_000, 8_000]);
export const SOURCE_POLL_MAX_DELAY_MS = 15_000;

/** Backoff between checks while the file is unreadable: 2s, 4s, 8s, then every 15s. */
export function sourcePollDelayMs(attempt) {
  return POLL_DELAYS_MS[attempt] ?? SOURCE_POLL_MAX_DELAY_MS;
}

/**
 * How long a mounted item waits for its file before falling back to the
 * normal exhausted state (and its Tap to Retry). Longer than any workout
 * video, so in practice a screen waits for as long as someone is in front of it.
 */
export const SOURCE_UNAVAILABLE_MAX_MS = 30 * 60_000;

/**
 * What a check answer means for the Player.
 *
 *   wait   — the file exists but cannot be read: hold, poll, spend nothing.
 *   resume — readable again after a wait: reload once at the saved position.
 *   retry  — readable, but we were not waiting: the refusal was transient, so
 *            reload now rather than sit until the startup deadline.
 *   normal — missing, unknown, or the check failed: let the ordinary recovery
 *            ladder decide, exactly as before this existed.
 *
 * A failed check or an `unknown` answer DURING a wait keeps waiting: the
 * backend restarting mid-outage says nothing about the file.
 */
export function decideSourceCheck({ state, waiting }) {
  if (state === 'unreadable') return 'wait';
  if (state === 'readable') return waiting ? 'resume' : 'retry';
  if (state === 'missing') return 'normal';
  return waiting ? 'wait' : 'normal';
}

/** "Video file unavailable — retrying · 2:05" */
export function sourceNoticeText({ mediaType, unavailableMs }) {
  const kind = mediaType === 'audio' ? 'Audio' : 'Video';
  const totalSeconds = Math.max(0, Math.floor((unavailableMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${kind} file unavailable — retrying · ${minutes}:${seconds}`;
}
