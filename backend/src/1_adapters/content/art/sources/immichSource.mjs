// immichSource.mjs — resolves an `immich` collection def into normalized candidates.
// Selectors: album (name|id), person (name|id), search (smart). IMAGE assets only.
// Dimensions via the shared immichDimensions helper (orientation-corrected);
// matte from preview bytes.
import { Jimp } from 'jimp';
import { buildPhotoTitle, formatPhotoDate } from '../../gallery/immich/photoLabels.mjs';
import { immichDimensions } from '../../gallery/immich/immichDimensions.mjs';

const MAX_RATIO = 16 / 9;
// Wider-than-tall hangs single; only true portraits (taller than wide) pair.
const PORTRAIT_RATIO = 1;

// All k-sized combinations of arr (order-independent). [] if k<=0 or k>arr.length.
export function combinations(arr, k) {
  if (k <= 0 || k > arr.length) return [];
  if (k === arr.length) return [arr.slice()];
  const result = [];
  const rec = (start, combo) => {
    if (combo.length === k) { result.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop(); }
  };
  rec(0, []);
  return result;
}

const PEOPLE_SEARCH_SIZE = 250;  // cap per combination search (bounded pool fetch)

export function createImmichSource({ client, fetchImageBytes, proxyPath, logger = console }) {
  async function resolveAssets(def) {
    if (def.favorites || def.isFavorite) {
      // Everything the family has starred in Immich. Paged because the pool can
      // exceed one search page; withExif/withPeople so placards get who/where/when.
      const all = [];
      let page = 1;
      for (;;) {
        let res;
        try {
          res = await client.searchMetadata({ isFavorite: true, withExif: true, withPeople: true, size: 250, page });
        } catch (err) {
          logger.warn?.('art.immich.favorites-search-failed', { error: err.message, page });
          break;
        }
        const items = res.items || [];
        all.push(...items);
        if (!res.nextPage || items.length === 0) break;
        page = Number(res.nextPage) || (page + 1);
      }
      logger.info?.('art.immich.favorites-resolved', { assets: all.length });
      return all;
    }
    if (def.album) {
      let albumId = def.album;
      const albums = await client.getAlbums();
      const match = (albums || []).find((a) => a.id === def.album || a.albumName === def.album);
      if (match) albumId = match.id;
      const album = await client.getAlbum(albumId);
      return album?.assets || [];
    }
    if (def.person) {
      let personId = def.person;
      const people = await client.getPeople({ withStatistics: false });
      const match = (people || []).find((p) => p.id === def.person || p.name === def.person);
      if (match) personId = match.id;
      // withExif/withPeople so the placard can name who's pictured and where.
      return (await client.getPersonAssets(personId, 100, { withExif: true, withPeople: true })) || [];
    }
    if (Array.isArray(def.people) && def.people.length > 0) {
      const minPeople = (Number.isInteger(def.minPeople) && def.minPeople > 0) ? def.minPeople : 2;
      const people = await client.getPeople({ withStatistics: false });
      const ids = def.people.map((name) => {
        const m = (people || []).find((p) => p.id === name || p.name === name);
        if (!m) logger.warn?.('art.immich.person-unresolved', { name });
        return m?.id || null;
      }).filter(Boolean);
      if (ids.length < minPeople) {
        logger.warn?.('art.immich.too-few-people', { resolved: ids.length, minPeople });
        return [];
      }
      const seen = new Map();
      for (const combo of combinations(ids, minPeople)) {
        let items = [];
        try {
          // withExif/withPeople: the metadata search omits exifInfo (city/date) and
          // the people array by default, which left the placard with only a day-period.
          items = (await client.searchMetadata({
            personIds: combo, size: PEOPLE_SEARCH_SIZE, withExif: true, withPeople: true,
          })).items || [];
        } catch (err) {
          logger.warn?.('art.immich.people-search-failed', { error: err.message });
          continue;
        }
        for (const a of items) if (a && a.id && !seen.has(a.id)) seen.set(a.id, a);
      }
      logger.info?.('art.immich.people-resolved', { requested: def.people.length, resolved: ids.length, minPeople, assets: seen.size });
      return [...seen.values()];
    }
    if (def.search) {
      return (await client.smartSearch(def.search, 50, { withExif: true, withPeople: true })) || [];
    }
    logger.warn?.('art.immich.no-selector', { def });
    return [];
  }

  function toCandidate(asset) {
    if (asset.type === 'VIDEO') return null;
    const ex = asset.exifInfo || {};
    // Orientation-corrected display dims: raw exif W/H read landscape for a
    // portrait shot tagged orientation 6/8. See immichDimensions.mjs.
    const { width, height } = immichDimensions(asset);
    if (!width || !height) return null;
    const ratio = width / height;
    if (ratio > MAX_RATIO) return null;                 // panoramic excluded
    const kind = ratio >= PORTRAIT_RATIO ? 'landscape' : 'portrait';
    // Prefer `localDateTime` (wall-clock at the place, rendered verbatim by the
    // photoLabels helpers) over `dateTimeOriginal`/`fileCreatedAt`, which are true
    // UTC instants and would print shifted by the server offset. See the TIMEZONE
    // CONTRACT in photoLabels.mjs.
    const date = asset.localDateTime || ex.dateTimeOriginal || asset.fileCreatedAt || null;
    const people = (asset.people || []).map((p) => p.name).filter(Boolean);
    const place = ex.city || ex.country || null;
    return {
      id: `immich:${asset.id}`,
      image: `${proxyPath}/assets/${asset.id}/thumbnail?size=preview`,
      width, height, kind,
      // Two-line brass placard, modelled on the Feed (ImmichFeedAdapter): people +
      // location (or time-of-day in a place / day-period) up top, the full human
      // date beneath. The date lives in `artist` (and `date` is left null) so the
      // placard always renders and the date is never printed twice.
      // width/height feed the frontend artLayout aspect-ratio math.
      meta: { title: buildPhotoTitle(people, place, date), artist: formatPhotoDate(date), date: null, width, height },
      loadImage: async () => Jimp.read(await fetchImageBytes(asset.id)),
    };
  }

  async function resolveCandidates(def = {}) {
    let assets;
    try {
      assets = await resolveAssets(def);
    } catch (err) {
      logger.warn?.('art.immich.resolve-failed', { error: err.message });
      return [];
    }
    const out = [];
    for (const a of assets) {
      const c = toCandidate(a);
      if (c) out.push(c);
    }
    logger.info?.('art.immich.resolved', { count: out.length });
    return out;
  }

  return { resolveCandidates };
}

export default createImmichSource;
