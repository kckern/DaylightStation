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

/**
 * A media error that COULD be a refusal but does not say so. Mid-playback,
 * Chromium reports a refused part without the HTTP status: "Format error" after
 * a URL refresh, "PIPELINE_ERROR_READ" after a remount (2026-09-29, a Bluey
 * episode Plex refused during a library scan — the ladder skipped it at 90%).
 * A suspicion only earns a backend check; the check decides.
 */
export function isSuspectedRefusal({ errorCode, errorMessage } = {}) {
  if (!REFUSAL_ERROR_CODES.includes(errorCode)) return false;
  return !isSourceRefusal({ errorCode, errorMessage });
}

/** Only Plex files go through the healer: `plex:123` or a bare rating key. */
export function toHealableContentId(contentId, plexId = null) {
  const raw = contentId ?? (plexId != null ? `plex:${plexId}` : null);
  const match = /^(?:plex:)?(\d+)$/.exec(String(raw ?? '').trim());
  return match ? `plex:${match[1]}` : null;
}

/**
 * The id the backend should check for the item that is PLAYING. A Player's
 * `plexId` is the queue ROOT (a show, a playlist), so it is only the last
 * resort: the playing item's own identity comes first. The backend rejects any
 * container that still slips through (`reason: 'not-a-leaf'`).
 */
export function resolveSourceContentId(meta, plexId = null) {
  for (const candidate of [meta?.contentId, meta?.assetId, meta?.id]) {
    const healable = toHealableContentId(candidate);
    if (healable) return healable;
  }
  return toHealableContentId(null, plexId);
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

/** Screens only: consecutive `unknown` answers after which a held item counts as missing. */
export const UNKNOWN_POLLS_BEFORE_MISSING = 4;

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
 *
 * `suspected` (the error never named a refusal): a readable answer means the
 * file is fine and the stream is the problem — that is the stall ladder's job,
 * so `normal`, never an extra reload outside the ladder's budget.
 */
export function decideSourceCheck({ state, waiting, suspected = false, hold = false, confirmed = false, unknownPolls = 0 }) {
  if (state === 'unreadable') return 'wait';
  if (state === 'readable') {
    if (waiting) return 'resume';
    return suspected ? 'normal' : 'retry';
  }
  if (state === 'missing') return 'normal';
  // A SCREEN (`hold`, opted in by the screen-framework owner only) never gives
  // a refused video up to the queue: when the element CONFIRMED a refusal
  // (403/404/503 / source-unreadable) and the backend cannot say more (unknown,
  // or the check itself failed), keep waiting — but a deleted item answers
  // `unknown` forever, so after UNKNOWN_POLLS_BEFORE_MISSING such answers it
  // is treated as missing (`normal`). Every other owner: previous behaviour.
  if (hold && (confirmed || waiting)) return unknownPolls >= UNKNOWN_POLLS_BEFORE_MISSING ? 'normal' : 'wait';
  return waiting ? 'wait' : 'normal';
}

/**
 * After the maximum wait a SCREEN (`hold`: opted in by the screen-framework
 * owner) holds on Tap to Retry / Skip instead of advancing the queue. Every
 * other owner (fitness, piano, school lessons, Media) keeps its previous cap
 * action.
 */
export function holdsAfterGaveUp({ reason, hold }) {
  return reason === 'source-unavailable-gave-up' && hold === true;
}

/** "Fixing this video… · 2:05" — quiet, TV-legible, no instructions in it. */
export function sourceNoticeText({ mediaType, unavailableMs }) {
  const kind = mediaType === 'audio' ? 'audio' : 'video';
  const totalSeconds = Math.max(0, Math.floor((unavailableMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `Fixing this ${kind}… · ${minutes}:${seconds}`;
}
