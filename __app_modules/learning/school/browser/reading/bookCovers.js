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
 * SIZED, not raw. `/api/v1/info` hands back the original proxied poster —
 * measured on this library anywhere from 640x640 to 1336x1920 — for a shelf box
 * that tops out at 205 CSS px on a panel running at devicePixelRatio 2. That is
 * a 3-9x browser bilinear downscale that varies per poster, which is the whole
 * reason the shelf looked blocky and inconsistent. `sizedPlexImage` hands Plex
 * the box instead and its resampler does the work once, server-side and cached.
 * The box is square because these are square audiobook sleeves in a square card
 * — the point is the RESAMPLE, not the crop; nothing is cropped either way.
 *
 * A failed lookup caches `null` — the shelf shows its spine placeholder and
 * does not ask again. A missing cover is not an error worth a retry storm on a
 * screen a child is standing in front of.
 */

import { sizedPlexImage, ART_BOX } from "../plexImage.js";

/**
 * contentId -> `{image, title}` as `/info` sent them (the UNSIZED image), or
 * null for "asked, and there isn't one". Sizing happens on the way out, so the
 * shelf and the refusal's suggestions share one lookup per book and each gets
 * the box it draws in.
 */
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
    if (!data) return null;
    const image = data.image ?? data.thumbnail ?? data.imageUrl ?? null;
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
    return image || title ? { image, title } : null;
  } catch {
    return null;
  }
}

/** The one deduped, sequential `/info` lookup behind both exports. */
function lookupOnce(contentId, fetchImpl) {
  if (cache.has(contentId)) return Promise.resolve(cache.get(contentId));
  if (inflight.has(contentId)) return inflight.get(contentId);

  const queued = chain
    .then(() => lookup(contentId, fetchImpl))
    .then((info) => {
      cache.set(contentId, info);
      inflight.delete(contentId);
      return info;
    });
  // The chain must survive a rejection, or one bad lookup stalls every later
  // one behind it forever.
  chain = queued.then(() => undefined, () => undefined);
  inflight.set(contentId, queued);
  return queued;
}

/**
 * @param {string} contentId
 * @param {Function} [fetchImpl] injectable for tests
 * @returns {Promise<string|null>} the shelf-sized cover url, or null when there isn't one
 */
export function bookCover(contentId, fetchImpl = globalThis.fetch) {
  if (!contentId) return Promise.resolve(null);
  return lookupOnce(contentId, fetchImpl)
    .then((info) => sizedPlexImage(info?.image ?? null, ...ART_BOX.readingShelf) ?? null);
}

/**
 * The cover AND Plex's title, for a surface that has only a sticker label to
 * go on (a refusal's suggestions). Same lookup as `bookCover`, sized for `box`.
 *
 * @param {string} contentId
 * @param {[number, number]} [box] CSS px the cover is drawn in
 * @param {Function} [fetchImpl] injectable for tests
 * @returns {Promise<{cover: string|null, title: string|null}>}
 */
export function bookInfo(contentId, box = ART_BOX.readingSuggestion, fetchImpl = globalThis.fetch) {
  if (!contentId) return Promise.resolve({ cover: null, title: null });
  return lookupOnce(contentId, fetchImpl).then((info) => ({
    cover: sizedPlexImage(info?.image ?? null, ...box) ?? null,
    title: info?.title ?? null,
  }));
}

export default bookCover;
