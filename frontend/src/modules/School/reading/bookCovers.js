/**
 * Cover lookup for the reading screen's Recent shelf.
 *
 * Covers come from the SAME place the pick's cover does — `/api/v1/info/{id}`
 * — so a book looks identical whether it is the one being confirmed or one of
 * the six on the shelf below.
 *
 * Two properties matter here, and both come from the household's media stack
 * rather than from taste:
 *
 *   - DEDUPED, process-wide and forever. The same book read on three different
 *     days is three rows on the shelf and exactly one request; a re-render is
 *     none. The cache is keyed by contentId and never invalidated, because a
 *     book's cover does not change inside the life of a kiosk page.
 *   - SEQUENTIAL. Plex serializes these requests anyway, so firing six at once
 *     buys nothing and makes the slowest one slower. The shelf renders its
 *     titles immediately and the covers fill in as they land, so a slow lookup
 *     costs a placeholder, never a blank screen.
 *
 * A failed lookup caches `null` — the shelf shows its spine placeholder and
 * does not ask again. A missing cover is not an error worth a retry storm on a
 * screen a child is standing in front of.
 */

/** contentId -> cover url, or null for "asked, and there isn't one". */
const cache = new Map();
/** contentId -> the in-flight promise, so concurrent callers share one request. */
const inflight = new Map();
/** The tail of the request chain — this is what keeps lookups sequential. */
let chain = Promise.resolve();

/** Reset between tests. Not used by the app. */
export function __resetBookCovers() {
  cache.clear();
  inflight.clear();
  chain = Promise.resolve();
}

async function lookup(contentId, fetchImpl) {
  try {
    const r = await fetchImpl(`/api/v1/info/${encodeURIComponent(contentId)}`, { credentials: 'same-origin' });
    const data = r?.ok ? await r.json() : null;
    return data?.image ?? data?.thumbnail ?? data?.imageUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} contentId
 * @param {Function} [fetchImpl] injectable for tests
 * @returns {Promise<string|null>} the cover url, or null when there isn't one
 */
export function bookCover(contentId, fetchImpl = globalThis.fetch) {
  if (!contentId) return Promise.resolve(null);
  if (cache.has(contentId)) return Promise.resolve(cache.get(contentId));
  if (inflight.has(contentId)) return inflight.get(contentId);

  const queued = chain
    .then(() => lookup(contentId, fetchImpl))
    .then((url) => {
      cache.set(contentId, url);
      inflight.delete(contentId);
      return url;
    });
  // The chain must survive a rejection, or one bad lookup stalls every later
  // one behind it forever.
  chain = queued.then(() => undefined, () => undefined);
  inflight.set(contentId, queued);
  return queued;
}

export default bookCover;
