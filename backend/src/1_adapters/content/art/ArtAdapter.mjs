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
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { deriveMatte, rgbToHsv } from '#domains/art/deriveMatte.mjs';
import { eligibleByRecency } from '#domains/art/recencyWindow.mjs';
import { createArtRecencyStore } from './artRecencyStore.mjs';

const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const meanRGB = (a, b) => [0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2));

export function createArtAdapter({ imgBasePath, dataPath = null, logger = console, collections = {}, artSource, immichSource = null, recencyFraction = 0.55, recencyStore } = {}) {
  // Lazily build the default art source from imgBasePath when one isn't injected
  // (tests inject a fake; production injects the real source — see app.mjs).
  let _artSource = artSource || null;
  const colorCache = new Map();   // candidate id → { avg, color }
  const thumbCache = new Map();   // collection name → representative image path (or null)
  let _presets = null;            // lazily-loaded artmode.yml presets map

  // Recency tempering: a persistent no-repeat window so shuffle stops favoring a
  // few works. Tests may inject a store (or `null` to disable); otherwise build
  // the default YAML store under media_memory when a data path is available.
  let _recencyStore = recencyStore;   // undefined ⇒ build lazily; null ⇒ disabled
  const resolveRecencyStore = () => {
    if (_recencyStore !== undefined) return _recencyStore;
    _recencyStore = dataPath
      ? createArtRecencyStore({
          filePath: path.join(dataPath, 'household', 'history', 'media_memory', 'art.yml'),
          logger,
        })
      : null;
    return _recencyStore;
  };

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
    const { key, def } = resolveCollection(collections, collection);
    const src = await sourceFor(def);
    if (!src) logger.warn?.('art.source.unavailable', { collection, source: def.source });
    let cands = src ? await src.resolveCandidates(def, key) : [];
    // If a *narrowing* collection (immich source, or any art selector) yields
    // nothing, widen to the full art pool so the screensaver never blanks. An
    // already-unfiltered `all` pool that comes back empty has nothing to widen
    // to — let it surface as "No artwork available" rather than re-querying.
    if (!cands || cands.length === 0) {
      const narrowing = def.source === 'immich' || Object.keys(def).length > 0;
      if (narrowing) {
        logger.warn?.('art.collection.empty', { collection, source: def.source ?? 'art' });
        const art = await getArtSource();
        cands = await art.resolveCandidates({}, 'all');
      }
    }
    return cands;
  }

  async function selectFeatured({ collection, pick = randomPick } = {}) {
    const cands = await candidatesFor(collection);
    if (!cands.length) throw new Error('No artwork available');

    // Bench the most-recently-shown works before picking the primary. The
    // companion is still drawn from the full pool (its tiered artist/credit
    // matching is the constraint that matters there), but both shown ids get
    // recorded so neither recurs as a primary too soon.
    const store = resolveRecencyStore();
    let pool = cands;
    if (store) {
      const recency = await store.load();
      pool = eligibleByRecency(cands, recency, recencyFraction);
    }

    const chosen = pick(pool);
    const a1 = await analyze(chosen);

    let companion = null;
    let result;
    if (chosen.kind === 'landscape') {
      result = { mode: 'single', matte: matteFromAvgs([a1.avg]), panels: [panelOut(chosen, a1)] };
    } else {
      const portraits = cands.filter((c) => c.kind === 'portrait');
      companion = pickCompanion(chosen, portraits, pick);
      if (!companion) {
        result = { mode: 'single', matte: matteFromAvgs([a1.avg]), panels: [panelOut(chosen, a1)] };
      } else {
        const a2 = await analyze(companion);
        result = {
          mode: 'diptych',
          matte: matteFromAvgs([a1.avg, a2.avg]),
          panels: [panelOut(chosen, a1), panelOut(companion, a2)],
        };
      }
    }

    if (store) {
      const ids = companion ? [chosen.id, companion.id] : [chosen.id];
      // Fire-and-forget: a write failure is logged in the store and must never
      // block serving the artwork.
      store.record(ids).catch(() => {});
    }
    return result;
  }

  // Resolve a collection to a flat list of underlying Immich asset IDs (no
  // color analysis, no diptych pairing, no recency tempering). The e-ink photo
  // endpoint reuses an art collection (e.g. `kids`: immich people + minPeople)
  // purely as its candidate pool, then loads the chosen asset itself. Only
  // Immich-backed collections are supported — the IDs returned are raw Immich
  // asset IDs (the `immich:` prefix stripped); file-based art collections return
  // []. Deliberately does NOT widen to the art pool on empty (unlike
  // candidatesFor): the caller wants Immich IDs, so an empty result must surface
  // rather than silently swapping in random classic art.
  async function collectionAssetIds(collection) {
    const { resolveCollection } = await import('./collections.mjs');
    const { def } = resolveCollection(collections, collection);
    if (def.source !== 'immich') {
      logger.warn?.('art.collectionAssetIds.not_immich', { collection, source: def.source ?? 'art' });
      return [];
    }
    const src = await sourceFor(def);
    if (!src) return [];
    const cands = await src.resolveCandidates(def);
    return (cands || [])
      .map((c) => String(c.id))
      .filter((id) => id.startsWith('immich:'))
      .map((id) => id.slice('immich:'.length));
  }

  // Presets live in artmode.yml (`presets.<name>.collection`). Loaded once; a
  // missing file is non-fatal (thumbnails just fall back to the raw key).
  async function loadPresets() {
    if (_presets) return _presets;
    if (!dataPath) { _presets = {}; return _presets; }
    try {
      const raw = await fs.readFile(path.join(dataPath, 'household', 'config', 'artmode.yml'), 'utf-8');
      _presets = (yaml.load(raw) || {}).presets || {};
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn?.('art.presets.read_failed', { error: err.message });
      _presets = {};
    }
    return _presets;
  }

  // Representative thumbnail for a menu card: maps a preset → its collection,
  // then picks a DETERMINISTIC candidate (first by sorted id — stable across
  // loads, no color analysis). Returns a `/media/img/...` path or null. Cached
  // per collection. Used by the /display/art:<preset> route.
  async function getThumbnailUrl(preset) {
    const presets = await loadPresets();
    const collection = presets[preset]?.collection ?? preset;   // also accept a raw collection key
    if (thumbCache.has(collection)) return thumbCache.get(collection);
    let image = null;
    try {
      const cands = await candidatesFor(collection);
      if (cands.length) {
        const chosen = [...cands].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
        image = chosen.image;
      }
    } catch (err) {
      logger.warn?.('art.thumbnail.failed', { preset, collection, error: err.message });
    }
    thumbCache.set(collection, image);
    return image;
  }

  return { source: 'art', selectFeatured, getThumbnailUrl, collectionAssetIds };
}

export default createArtAdapter;
