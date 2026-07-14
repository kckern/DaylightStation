// frontend/src/modules/Media/session/containerExpansion.js
// Container → playable-children expansion for queue actions.
//
// "Play album plays one track and stops" root cause: queue inputs for
// containers (album/show/playlist/…) were enqueued as a single item; the
// play endpoint resolves them to ONE leaf, so the queue drained after one
// track. This module fetches a container's children from the list router
// (`GET /api/v1/list/<source>/<localId>` → `{ items: [...] }`) and maps them
// to queue inputs, preserving order, so the whole container is enqueued.
//
// Depth policy: one level of expansion; if a child is itself a container
// (e.g. a show's seasons) we recurse ONE more level, then stop. A hard cap
// bounds the total item count. Any failure (fetch error, malformed body,
// zero usable children) yields `null` so the caller degrades to the current
// single-item behavior — a tap must never be dead.

/** Metadata types that mark a container in search/browse rows. */
export const CONTAINER_TYPES = new Set([
  'show', 'season', 'album', 'artist', 'collection', 'playlist',
]);

/** Hard cap on the number of expanded queue inputs. */
export const EXPANSION_LIMIT = 500;

/** Beyond the root fetch, recurse at most this many nested levels. */
export const MAX_NESTED_DEPTH = 1;

const VIDEO_TYPES = new Set(['episode', 'movie', 'clip', 'video', 'trailer']);
const AUDIO_TYPES = new Set(['track', 'song']);

function typeOf(obj) {
  const t = obj?.type ?? obj?.metadata?.type;
  return typeof t === 'string' ? t.toLowerCase() : null;
}

/**
 * True when a queue input (or list item) is a container that should be
 * expanded. Explicit `itemType` wins; metadata type and childCount are
 * fallbacks for rows that only carry those markers.
 */
export function isContainerInput(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.itemType === 'container') return true;
  if (input.itemType === 'leaf') return false;
  const type = typeOf(input);
  if (type && CONTAINER_TYPES.has(type)) return true;
  const childCount = input.childCount ?? input.metadata?.childCount;
  return typeof childCount === 'number' && childCount > 0;
}

function formatForChild(item, inheritedFormat) {
  const type = typeOf(item);
  if (type && AUDIO_TYPES.has(type)) return 'audio';
  if (type && VIDEO_TYPES.has(type)) return 'video';
  const mediaType = item?.mediaType;
  if (mediaType === 'audio' || mediaType === 'video') return mediaType;
  return inheritedFormat ?? null;
}

/** Minimal `source:localId` split (first colon; ids never contain spaces). */
function splitContentId(contentId) {
  if (typeof contentId !== 'string') return null;
  const idx = contentId.indexOf(':');
  if (idx <= 0 || idx === contentId.length - 1) return null;
  return { source: contentId.slice(0, idx), localId: contentId.slice(idx + 1) };
}

function childToQueueInput(item, { containerTitle, inheritedFormat }) {
  const contentId = item?.play?.contentId ?? item?.id ?? null;
  if (typeof contentId !== 'string' || contentId.length === 0) return null;
  return {
    contentId,
    title: item.title ?? item.label ?? contentId,
    thumbnail: item.thumbnail ?? item.image ?? null,
    duration: typeof item.duration === 'number' ? item.duration : null,
    format: formatForChild(item, inheritedFormat),
    // Preserved for display: which show/album this child came from.
    containerTitle: containerTitle ?? null,
  };
}

/**
 * Expand a container queue input into an ordered array of leaf queue inputs.
 *
 * @param {object} input - queue input carrying at least `contentId`; `title`
 *   is preserved on children as `containerTitle`.
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl] - injectable fetch for tests.
 * @param {number} [opts.limit] - hard cap on expanded items.
 * @param {number} [opts.maxDepth] - nested-container recursion budget.
 * @returns {Promise<Array<object>|null>} ordered queue inputs, or `null`
 *   when expansion is impossible (caller falls back to single-item).
 */
export async function expandContainerInput(input, {
  fetchImpl,
  limit = EXPANSION_LIMIT,
  maxDepth = MAX_NESTED_DEPTH,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const containerTitle = input?.title ?? null;
  const inheritedFormat = input?.format ?? null;
  const out = [];

  const fetchChildren = async (contentId) => {
    const parsed = splitContentId(contentId);
    if (!parsed) return null;
    const url = `/api/v1/list/${encodeURIComponent(parsed.source)}/${encodeURIComponent(parsed.localId)}`;
    const res = await doFetch(url);
    if (!res || !res.ok) return null;
    const body = await res.json();
    return Array.isArray(body?.items) ? body.items : null;
  };

  const walk = async (contentId, depth) => {
    const children = await fetchChildren(contentId);
    if (!children) return;
    for (const child of children) {
      if (out.length >= limit) return;
      if (isContainerInput(child)) {
        // Nested container (e.g. a show's season): one more level, then stop.
        if (depth < maxDepth && typeof child.id === 'string') {
          try { await walk(child.id, depth + 1); } catch { /* skip branch */ }
        }
        continue;
      }
      const queueInput = childToQueueInput(child, { containerTitle, inheritedFormat });
      if (queueInput) out.push(queueInput);
    }
  };

  try {
    await walk(input?.contentId, 0);
  } catch {
    return null;
  }
  return out.length > 0 ? out : null;
}

export default expandContainerInput;
