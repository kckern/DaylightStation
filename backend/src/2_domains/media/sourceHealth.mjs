/**
 * Media source health — pure rules for "can the media server read this file?"
 *
 * The 2026-09-28 incident: the NAS behind Plex reported mode 0000 on thousands
 * of Fitness files in a transient burst. Plex answered every direct-play request
 * for them with a 404 ("Permission denied (13)" in its own log), which the player
 * read as "file does not exist" and gave up on. These rules classify what Plex
 * reports and shape the one push an adult gets when a file stays unreadable.
 *
 * See docs/reference/player/media-source-healing.md.
 */

import { formatDuration } from '../notification/push/pushText.mjs';

export const SOURCE_STATE = Object.freeze({
  readable: 'readable',
  unreadable: 'unreadable',
  missing: 'missing',
  unknown: 'unknown',
});

/**
 * `plex:696316` / `696316` → `'696316'`. Anything that is not a Plex rating key
 * returns null: only Plex files go through the healer.
 */
export function parsePlexRatingKey(contentId) {
  const match = /^(?:plex:)?(\d+)$/.exec(String(contentId ?? '').trim());
  return match ? match[1] : null;
}

/**
 * Classify the parts of a Plex metadata item fetched with `checkFiles=1`.
 * Plex sets `exists` and `accessible` on every part when asked to check.
 * A multi-part item is only as readable as its worst part.
 */
export function classifyPlexParts(parts) {
  const list = Array.isArray(parts) ? parts.filter(Boolean) : [];
  if (!list.length) return { state: SOURCE_STATE.unknown, part: null };
  const missing = list.find((p) => p.exists === false);
  if (missing) return { state: SOURCE_STATE.missing, part: missing };
  const unreadable = list.find((p) => p.accessible === false);
  if (unreadable) return { state: SOURCE_STATE.unreadable, part: unreadable };
  if (list.every((p) => p.accessible === true)) return { state: SOURCE_STATE.readable, part: list[0] };
  // Plex did not report on accessibility (older server, or checkFiles ignored).
  return { state: SOURCE_STATE.unknown, part: list[0] };
}

/**
 * The push sent when a media file has been unreadable long enough that someone
 * is plainly waiting on it. Names, never ids (push standard rule 1).
 */
export function composeSourceUnreadablePush({ title, showTitle = null, unreadableMs }) {
  const name = title ? `"${title}"` : 'a video';
  const from = showTitle ? ` (${showTitle})` : '';
  const duration = formatDuration(unreadableMs) || '1 min';
  return {
    title: 'A video won\'t open',
    body: `Plex has not been able to read ${name}${from} from the NAS for ${duration}. `
      + 'The screen is waiting and will start playing by itself once the file is readable again.',
  };
}
