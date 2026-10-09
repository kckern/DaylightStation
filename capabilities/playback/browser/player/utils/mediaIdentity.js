export const resolveMediaIdentity = (meta) => {
  if (!meta) return null;
  const candidate = meta.assetId
    ?? meta.key
    ?? meta.plex
    ?? meta.media
    ?? meta.id
    ?? meta.guid
    ?? meta.mediaUrl
    ?? null;
  return candidate != null ? String(candidate) : null;
};

/**
 * Resolve media identity with source namespace prefix.
 * Returns format like "plex:649319" for source-aware identification.
 * Falls back to bare ID if source cannot be determined.
 */
export const resolveContentId = (metadata) => {
  const bareId = resolveMediaIdentity(metadata);
  if (!bareId) return null;

  // If already namespaced, return as-is
  if (typeof bareId === 'string' && bareId.includes(':')) return bareId;

  // Determine source from metadata
  const source = metadata?.source
    || (metadata?.plex != null ? 'plex' : null)
    || (metadata?.assetId != null ? 'plex' : null)
    || (metadata?.key != null ? 'plex' : null)
    || 'plex';

  return `${source}:${bareId}`;
};

/** First candidate that parses to a positive finite number, else null. */
const firstPositive = (candidates) => {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const n = typeof candidate === 'string' ? parseFloat(candidate) : Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

/**
 * Duration in whole seconds, from candidates the caller declares to be SECONDS.
 *
 * The unit is the caller's to state, never ours to infer. A predecessor
 * (`normalizeDuration`) guessed it from magnitude — treating anything over 1000
 * as milliseconds — which was right while its inputs were Plex's native
 * milliseconds and silently wrong from the moment they became seconds: every
 * video longer than 16m40s was divided by 1000 a second time and stored as a
 * 1-11 second duration. No threshold can separate "1941 seconds" from "1941
 * milliseconds", so the guess is removed rather than retuned.
 *
 * See docs/_wip/bugs/2026-09-01-media-duration-divided-twice.md
 *
 * @param {...(number|string|null|undefined)} candidates - seconds, in preference order
 * @returns {number|null}
 */
export const durationFromSeconds = (...candidates) => {
  const n = firstPositive(candidates);
  return n == null ? null : Math.round(n);
};

/**
 * Duration in whole seconds, from candidates the caller declares to be
 * MILLISECONDS (e.g. Plex's raw `Metadata.duration`).
 *
 * @param {...(number|string|null|undefined)} candidates - milliseconds, in preference order
 * @returns {number|null}
 */
export const durationFromMs = (...candidates) => {
  const n = firstPositive(candidates);
  return n == null ? null : Math.round(n / 1000);
};

/**
 * Fields that identify WHAT is playing, in precedence order. `contentId` is
 * first among the non-guid fields because piano/kiosk callers pass only that.
 * `resolveMediaIdentity` deliberately omits it — that function answers "which
 * Plex asset", this one answers "is this the same source object, semantically".
 */
const SOURCE_CONTENT_FIELDS = ['guid', 'contentId', 'assetId', 'key', 'plex', 'media', 'id', 'mediaUrl'];

/**
 * Does this value actually name a piece of content?
 *
 * Only strings and finite numbers do. A present-but-empty field must not win the
 * precedence race and stop the scan before it reaches the field that carries the real
 * identity: `{ guid: false, contentId: 'plex:694719' }` has to resolve by contentId,
 * the same outcome `ensureEntryGuid` reaches by skipping a falsy guid.
 *
 * The predicate is NOT plain truthiness, and the one place the two part company is
 * `0`: falsy, but a numeric key of zero is a usable id, so it counts here. (For the
 * `guid` field specifically that means `{ guid: 0 }` resolves by guid here while
 * `ensureEntryGuid` would fall through — harmless, since a guid of 0 does not occur
 * and both paths still produce a stable, content-derived key.) `false`, `NaN` and
 * `Infinity` never identify anything. Objects are rejected too — every field here
 * holds a scalar (SinglePlayer types `media` as a string), and interpolating an
 * object yields "[object Object]", which would collapse distinct sources onto one key.
 */
const identifies = (value) => {
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  return false;
};

/**
 * Stable content key for a play/queue source object.
 *
 * The Player used to identify a source by OBJECT IDENTITY (a WeakMap keyed on
 * the object), so a caller re-creating an equivalent `play` literal on re-render
 * minted a new media guid, changed the player key, and remounted the video —
 * each remount opening a fresh Plex transcode session (2026-08-16: 495 sessions
 * in 4 minutes). Keying on content instead makes an equivalent object a no-op.
 *
 * @returns {string|null} e.g. "contentId:plex:694719", or null if unidentifiable.
 */
export const resolveSourceContentKey = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  for (const field of SOURCE_CONTENT_FIELDS) {
    const value = source[field];
    if (identifies(value)) return `${field}:${value}`;
  }
  return null;
};
