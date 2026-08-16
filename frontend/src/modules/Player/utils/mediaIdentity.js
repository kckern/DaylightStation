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

const MIN_PLAUSIBLE_DURATION_SEC = 10;

export const normalizeDuration = (...candidates) => {
  const toSeconds = (v) => {
    if (v == null) return null;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 1000 ? Math.round(n / 1000) : Math.round(n);
  };

  // First pass: prefer candidates that look like real media durations (≥ 10s).
  // This skips Plex metadata placeholders (e.g. season number "2") that can
  // appear in media.duration before the HTML5 player reports the real value.
  for (const candidate of candidates) {
    const sec = toSeconds(candidate);
    if (sec != null && sec >= MIN_PLAUSIBLE_DURATION_SEC) return sec;
  }

  // Fallback: accept any positive value (for genuinely short media)
  for (const candidate of candidates) {
    const sec = toSeconds(candidate);
    if (sec != null) return sec;
  }
  return null;
};

/**
 * Fields that identify WHAT is playing, in precedence order. `contentId` is
 * first among the non-guid fields because piano/kiosk callers pass only that.
 * `resolveMediaIdentity` deliberately omits it — that function answers "which
 * Plex asset", this one answers "is this the same source object, semantically".
 */
const SOURCE_CONTENT_FIELDS = ['guid', 'contentId', 'assetId', 'key', 'plex', 'media', 'id', 'mediaUrl'];

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
    if (value != null && value !== '') return `${field}:${value}`;
  }
  return null;
};
