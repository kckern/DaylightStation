/** Provider-neutral video quality intent. Bitrate is kbps; resolution is a class. */
export const PLAYBACK_QUALITY_KEYS = Object.freeze(['maxResolution', 'maxVideoBitrate', 'transcode', 'adaptive']);
const RESOLUTIONS = new Set(['240', '360', '480', '720', '1080', '1440', '2160']);

function invalid(field, expected) {
  const error = new TypeError(`${field}: ${expected}`);
  error.status = 400;
  error.code = 'VALIDATION';
  throw error;
}

function resolution(value) {
  if (typeof value !== 'string' && typeof value !== 'number') invalid('maxResolution', 'expected a resolution class');
  const normalized = String(value).replace(/p$/, '');
  if (!RESOLUTIONS.has(normalized)) invalid('maxResolution', 'expected 240, 360, 480, 720, 1080, 1440 or 2160');
  return normalized;
}

/** Normalize only quality fields; omission preserves the existing playback policy. */
export function normalizePlaybackQuality(input = {}) {
  const result = {};
  if (input.maxResolution != null) result.maxResolution = resolution(input.maxResolution);
  if (input.maxVideoResolution != null) {
    const alias = resolution(input.maxVideoResolution);
    if (result.maxResolution != null && result.maxResolution !== alias) invalid('maxResolution', 'conflicts with maxVideoResolution');
    result.maxResolution = alias;
  }
  if (input.maxVideoBitrate != null) {
    const value = input.maxVideoBitrate;
    if ((typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)))
      || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) invalid('maxVideoBitrate', 'expected a positive integer in kbps');
    result.maxVideoBitrate = Number(value);
  }
  if (input.transcode != null) {
    if (!['auto', 'force'].includes(input.transcode)) invalid('transcode', 'expected auto or force');
    result.transcode = input.transcode;
  }
  if (input.adaptive != null) {
    if (![true, false, 'true', 'false'].includes(input.adaptive)) invalid('adaptive', 'expected true or false');
    result.adaptive = input.adaptive === true || input.adaptive === 'true';
  }
  return result;
}

/** Replace an item's overrides, including clearing previously selected caps. */
export function withPlaybackQuality(item, quality = {}) {
  const next = { ...item };
  for (const key of [...PLAYBACK_QUALITY_KEYS, 'maxVideoResolution']) delete next[key];
  const normalized = normalizePlaybackQuality(quality);
  // An explicit replacement (including {}) is authoritative over launch defaults.
  return { ...next, ...normalized, qualityOverrides: normalized };
}

/** A command always names the visit it is intended to change. */
export function normalizePlaybackQualityChange(input = {}) {
  if (typeof input.contentId !== 'string' || !input.contentId) invalid('contentId', 'required for a quality change');
  if (!input.quality || typeof input.quality !== 'object' || Array.isArray(input.quality)) invalid('quality', 'expected an overrides object');
  const result = { contentId: input.contentId, quality: normalizePlaybackQuality(input.quality) };
  for (const key of ['queueItemId', 'sessionId']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key]) invalid(key, 'expected a non-empty string');
    result[key] = input[key];
  }
  return result;
}

/** Providers currently implementing explicit video quality intent. Containers may pass it to video children. */
export function supportsPlaybackQuality(item) {
  const id = item?.contentId ?? item?.id ?? '';
  const kinds = [item?.type, item?.metadata?.type, item?.mediaType, item?.format];
  return /^plex(?:-[^:]+)?:/.test(id) && !kinds.some(kind =>
    ['audio', 'track', 'song', 'album', 'artist', 'image', 'photo', 'readalong', 'singalong'].includes(kind));
}

/** Snapshot mutation for a quality change on one current visit, never a new Play. */
export function playbackQualityChange(snapshot, { contentId, queueItemId, sessionId, quality } = {}) {
  if (!snapshot?.currentItem) return { ok: false, code: 'NO_PLAYBACK' };
  const entry = snapshot.queue?.items?.[snapshot.queue?.currentIndex];
  if (contentId !== snapshot.currentItem.contentId
    || (queueItemId != null && queueItemId !== entry?.queueItemId)
    || (sessionId != null && sessionId !== snapshot.sessionId)) return { ok: false, code: 'PLAYBACK_CHANGED' };
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)) invalid('quality', 'expected an overrides object');
  if (!supportsPlaybackQuality(snapshot.currentItem)) return { ok: false, code: 'QUALITY_UNSUPPORTED' };
  const normalized = normalizePlaybackQuality(quality);
  return { ok: true, snapshot: {
    ...snapshot,
    currentItem: withPlaybackQuality(snapshot.currentItem, normalized),
    queue: { ...snapshot.queue, items: (snapshot.queue?.items ?? []).map((item, index) =>
      index === snapshot.queue.currentIndex ? withPlaybackQuality(item, normalized) : item) },
  } };
}
