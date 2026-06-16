// immichSource.mjs — resolves an `immich` collection def into normalized candidates.
// Selectors: album (name|id), person (name|id), search (smart). IMAGE assets only.
// Dimensions from exifInfo (fallback asset.width/height); matte from preview bytes.
import { Jimp } from 'jimp';

const MAX_RATIO = 16 / 9;
// Wider-than-tall hangs single; only true portraits (taller than wide) pair.
const PORTRAIT_RATIO = 1;

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

// Names → "A", "A and B", "A, B, and C" (mirrors how the Feed labels photos).
const formatPeopleList = (names) => {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
};

// Top placard line: who's pictured, then where (either may be absent). The date
// goes on the second line (see toCandidate), so it is deliberately omitted here —
// folding it in too is what made the placard print the date twice.
const photoLabel = (people, place) => {
  const parts = [];
  if (people.length) parts.push(formatPeopleList(people));
  if (place) parts.push(place);
  return parts.join(' • ') || null;
};

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
      return (await client.getPersonAssets(personId)) || [];
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
          items = (await client.searchMetadata({ personIds: combo, size: PEOPLE_SEARCH_SIZE })).items || [];
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
      return (await client.smartSearch(def.search)) || [];
    }
    logger.warn?.('art.immich.no-selector', { def });
    return [];
  }

  function toCandidate(asset) {
    if (asset.type === 'VIDEO') return null;
    const ex = asset.exifInfo || {};
    const width = ex.exifImageWidth || asset.width || null;
    const height = ex.exifImageHeight || asset.height || null;
    if (!width || !height) return null;
    const ratio = width / height;
    if (ratio > MAX_RATIO) return null;                 // panoramic excluded
    const kind = ratio >= PORTRAIT_RATIO ? 'landscape' : 'portrait';
    const date = ex.dateTimeOriginal || asset.localDateTime || asset.fileCreatedAt || null;
    const people = (asset.people || []).map((p) => p.name).filter(Boolean);
    const place = ex.city || ex.country || null;
    const formattedDate = fmtDate(date);
    return {
      id: `immich:${asset.id}`,
      image: `${proxyPath}/assets/${asset.id}/thumbnail?size=preview`,
      width, height, kind,
      // Two-line brass placard, modelled on the Feed's photo labels: people +
      // location up top (meta.title), the date beneath. The date lives in `artist`
      // (and `date` is left null) so the placard always renders even when a photo
      // has no people/location, and the date is never printed twice.
      // width/height feed the frontend artLayout aspect-ratio math.
      meta: { title: photoLabel(people, place), artist: formattedDate, date: null, width, height },
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
