// immichSource.mjs — resolves an `immich` collection def into normalized candidates.
// Selectors: album (name|id), person (name|id), search (smart). IMAGE assets only.
// Dimensions from exifInfo (fallback asset.width/height); matte from preview bytes.
import { Jimp } from 'jimp';

const MAX_RATIO = 16 / 9;
const MIN_RATIO = 4 / 3;

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

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
    const kind = ratio >= MIN_RATIO ? 'landscape' : 'portrait';
    const date = ex.dateTimeOriginal || asset.localDateTime || asset.fileCreatedAt || null;
    const people = (asset.people || []).map((p) => p.name).filter(Boolean);
    const place = ex.city || ex.country || null;
    const formattedDate = fmtDate(date);
    const subtitle = [formattedDate, people.join(', ') || null].filter(Boolean).join(' · ') || null;
    return {
      id: `immich:${asset.id}`,
      image: `${proxyPath}/assets/${asset.id}/thumbnail?size=preview`,
      width, height, kind,
      // width/height in meta feed the frontend artLayout aspect-ratio math.
      meta: { title: place, artist: subtitle, date: formattedDate, width, height },
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
