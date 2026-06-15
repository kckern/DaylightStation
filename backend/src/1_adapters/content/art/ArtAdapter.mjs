/**
 * ArtAdapter — selects artwork(s) for ArtMode from a named collection.
 *
 * A collection resolves (via a source resolver: art | immich) to normalized
 * candidates { id, image, width, height, kind, meta, loadImage }. Eligibility
 * and classification are done by the source (kind set; panoramic excluded).
 * A landscape primary shows singly; a portrait primary pairs with a companion
 * (tiered: same artist+credit → artist → credit → any) into a diptych with a
 * shared matte. Per-candidate color is cached by id for the process.
 *
 * Returns { mode: 'single'|'diptych', matte, panels: [{ image, meta, color }] }.
 */
import { deriveMatte, rgbToHsv } from '../../../2_domains/art/deriveMatte.mjs';

const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const meanRGB = (a, b) => [0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2));

export function createArtAdapter({ imgBasePath, logger = console, collections = {}, artSource, immichSource = null } = {}) {
  // Lazily build the default art source from imgBasePath when one isn't injected
  // (tests inject a fake; production injects the real source — see app.mjs).
  let _artSource = artSource || null;
  const colorCache = new Map();   // candidate id → { avg, color }

  async function getArtSource() {
    if (_artSource) return _artSource;
    const { createArtSource } = await import('./sources/artSource.mjs');
    _artSource = createArtSource({ imgBasePath, logger });
    return _artSource;
  }

  async function sourceFor(def) {
    if (def.source === 'immich') {
      if (!immichSource) { logger.warn?.('art.immich.unavailable'); return null; }
      return immichSource;
    }
    return getArtSource();
  }

  async function analyze(candidate) {
    const hit = colorCache.get(candidate.id);
    if (hit) return hit;
    let result = { avg: null, color: null };
    try {
      const img = await candidate.loadImage();
      img.resize({ w: 32, h: 32 });
      const d = img.bitmap.data;
      let r = 0, g = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      const [h, s, v] = rgbToHsv(avg);
      result = {
        avg,
        color: {
          average: '#' + avg.map((c) => c.toString(16).padStart(2, '0')).join(''),
          hue: Math.round(h * 360),
          saturation: Math.round(s * 1000) / 1000,
          value: Math.round(v * 1000) / 1000,
        },
      };
    } catch (err) {
      logger.warn?.('art.color.failed', { id: candidate.id, error: err.message });
    }
    colorCache.set(candidate.id, result);
    return result;
  }

  function pickCompanion(primary, portraits, pick) {
    const pool = portraits.filter((p) => p.id !== primary.id);
    if (pool.length === 0) return null;
    const a = primary.meta?.artist;
    const c = primary.meta?.credit;
    const tiers = [
      pool.filter((p) => a && c && p.meta?.artist === a && p.meta?.credit === c),
      pool.filter((p) => a && p.meta?.artist === a),
      pool.filter((p) => c && p.meta?.credit === c),
      pool,
    ];
    for (const tier of tiers) if (tier.length) return pick(tier);
    return null;
  }

  function matteFromAvgs(avgs) {
    const present = avgs.filter(Boolean);
    if (present.length === 0) return null;
    const avg = present.length === 1 ? present[0] : meanRGB(present[0], present[1]);
    return deriveMatte(avg);
  }

  const panelOut = (cand, analysis) => ({ image: cand.image, meta: cand.meta, color: analysis.color });

  async function candidatesFor(collection) {
    const { resolveCollection } = await import('./collections.mjs');
    const { def } = resolveCollection(collections, collection);
    const src = await sourceFor(def);
    let cands = src ? await src.resolveCandidates(def) : [];
    if ((!cands || cands.length === 0)) {
      // Fall back to the full art pool so the screensaver never blanks.
      logger.warn?.('art.collection.empty', { collection });
      const art = await getArtSource();
      cands = await art.resolveCandidates({});
    }
    return cands;
  }

  async function selectFeatured({ collection, pick = randomPick } = {}) {
    const cands = await candidatesFor(collection);
    if (!cands.length) throw new Error('No artwork available');

    const chosen = pick(cands);
    const a1 = await analyze(chosen);

    if (chosen.kind === 'landscape') {
      return { mode: 'single', matte: matteFromAvgs([a1.avg]), panels: [panelOut(chosen, a1)] };
    }
    const portraits = cands.filter((c) => c.kind === 'portrait');
    const companion = pickCompanion(chosen, portraits, pick);
    if (!companion) {
      return { mode: 'single', matte: matteFromAvgs([a1.avg]), panels: [panelOut(chosen, a1)] };
    }
    const a2 = await analyze(companion);
    return {
      mode: 'diptych',
      matte: matteFromAvgs([a1.avg, a2.avg]),
      panels: [panelOut(chosen, a1), panelOut(companion, a2)],
    };
  }

  return { selectFeatured };
}

export default createArtAdapter;
