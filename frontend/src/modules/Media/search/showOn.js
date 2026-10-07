// frontend/src/modules/Media/search/showOn.js
// FIND.8b/AC3 (RQ-FIND-09): cameras and single photos are the one exception
// to "a tap plays at the aim" — a tap shows them on the device in hand, and
// "Show on…" is the second action. This decides which results are those.
const SHOW_TYPES = new Set(['photo', 'image', 'camera', 'snapshot', 'still']);
const SHOW_SOURCES = new Set(['camera', 'cameras', 'frigate']);

function typeOf(item) {
  const t = item?.type ?? item?.metadata?.type ?? null;
  return t ? String(t).toLowerCase() : null;
}

function sourceOf(item) {
  if (item?.source) return String(item.source).toLowerCase();
  const id = typeof item?.id === 'string' ? item.id : '';
  const colon = id.indexOf(':');
  return colon > 0 ? id.slice(0, colon).toLowerCase() : null;
}

/** True for a camera feed or a single photo (never a collection of them). */
export function isShowItem(item) {
  if (!item) return false;
  if (item.itemType === 'container' || item.itemType === 'collection') return false;
  if (String(item.mediaType ?? '').toLowerCase() === 'image') return true;
  if (SHOW_TYPES.has(typeOf(item))) return true;
  return SHOW_SOURCES.has(sourceOf(item ?? {}));
}

export default isShowItem;
