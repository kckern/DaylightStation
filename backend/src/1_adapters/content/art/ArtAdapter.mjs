/**
 * ArtAdapter — selects classic artwork(s) for ArtMode.
 *
 * Eligibility keeps every work whose aspect ratio (w/h) is ≤ 16:9 (panoramic
 * excluded) and classifies it: 'landscape' (4:3–16:9) or 'portrait' (taller
 * than 4:3, incl. square). A landscape primary is shown singly; a portrait
 * primary is paired with a companion (tiered: same artist+credit → artist →
 * credit → any) into a diptych with a shared matte.
 *
 * Returns { mode: 'single'|'diptych', matte, panels: [{ image, meta, color }] }.
 * The eligible index + per-folder resolution are cached for the process.
 */
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Jimp } from 'jimp';
import { deriveMatte, rgbToHsv } from '../../../2_domains/art/deriveMatte.mjs';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIN_RATIO = 4 / 3;   // landscape floor; below → portrait
const MAX_RATIO = 16 / 9;  // panoramic ceiling; above → excluded
const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const meanRGB = (a, b) => [0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2));

export function createArtAdapter({ imgBasePath, logger = console }) {
  const artDir = path.join(imgBasePath, 'art', 'classic');
  let eligibleCache = null;            // [{ folder, meta, kind }]
  const resolveCache = new Map();      // folder → { image, meta, avg, color }

  async function readMeta(folder) {
    try {
      const raw = await fs.readFile(path.join(artDir, folder, 'metadata.yaml'), 'utf-8');
      const parsed = yaml.load(raw) || {};
      return {
        title: parsed.title ?? null,
        artist: parsed.artist ?? null,
        date: parsed.date != null ? String(parsed.date) : null,
        origin: parsed.origin ?? null,
        medium: parsed.medium ?? null,
        credit: parsed.credit ?? null,
        width: toInt(parsed.width),
        height: toInt(parsed.height),
      };
    } catch (err) {
      logger.warn?.('art.metadata.missing', { folder, error: err.message });
      return null;
    }
  }

  async function buildEligible() {
    let entries;
    try {
      entries = await fs.readdir(artDir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`No artwork available: ${err.message}`);
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const eligible = [];
    for (const folder of folders) {
      const meta = await readMeta(folder);
      if (!meta || !meta.width || !meta.height) continue;
      const ratio = meta.width / meta.height;
      if (ratio > MAX_RATIO) continue; // panoramic excluded
      const kind = ratio >= MIN_RATIO ? 'landscape' : 'portrait';
      eligible.push({ folder, meta, kind });
    }
    logger.info?.('art.index.built', {
      total: folders.length,
      landscape: eligible.filter((e) => e.kind === 'landscape').length,
      portrait: eligible.filter((e) => e.kind === 'portrait').length,
    });
    return eligible;
  }

  async function analyzeColor(imagePath) {
    const img = await Jimp.read(imagePath);
    img.resize({ w: 32, h: 32 }); // jimp mutates in place
    const d = img.bitmap.data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    const [h, s, v] = rgbToHsv(avg);
    return {
      avg,
      color: {
        average: '#' + avg.map((c) => c.toString(16).padStart(2, '0')).join(''),
        hue: Math.round(h * 360),
        saturation: Math.round(s * 1000) / 1000,
        value: Math.round(v * 1000) / 1000,
      },
    };
  }

  // Resolve a folder to { image, meta, avg, color }. Throws if no image file.
  async function resolveFolder(entry) {
    const cached = resolveCache.get(entry.folder);
    if (cached) return cached;
    const folderPath = path.join(artDir, entry.folder);
    const files = await fs.readdir(folderPath);
    const imageFile = files.find(
      (f) => !f.startsWith('.') && IMAGE_EXTS.includes(path.extname(f).toLowerCase())
    );
    if (!imageFile) throw new Error(`No image file in art folder: ${entry.folder}`);
    const image =
      `/media/img/art/classic/${encodeURIComponent(entry.folder)}/${encodeURIComponent(imageFile)}`;
    let avg = null, color = null;
    try {
      ({ avg, color } = await analyzeColor(path.join(folderPath, imageFile)));
    } catch (err) {
      logger.warn?.('art.color.failed', { folder: entry.folder, error: err.message });
    }
    const resolved = { folder: entry.folder, image, meta: entry.meta, avg, color };
    resolveCache.set(entry.folder, resolved);
    return resolved;
  }

  // Tiered companion: same artist+credit → same artist → same credit → any.
  function pickCompanion(primary, portraits, pick) {
    const pool = portraits.filter((p) => p.folder !== primary.folder);
    if (pool.length === 0) return null;
    const a = primary.meta.artist;
    const c = primary.meta.credit;
    const tiers = [
      pool.filter((p) => a && c && p.meta.artist === a && p.meta.credit === c),
      pool.filter((p) => a && p.meta.artist === a),
      pool.filter((p) => c && p.meta.credit === c),
      pool, // last tier is the full (non-empty) pool → the loop always returns
    ];
    for (const tier of tiers) if (tier.length) return pick(tier);
    return null; // unreachable
  }

  function matteFromAvgs(avgs) {
    const present = avgs.filter(Boolean);
    if (present.length === 0) return null;
    const avg = present.length === 1 ? present[0] : meanRGB(present[0], present[1]);
    return deriveMatte(avg);
  }

  const panelOut = (p) => ({ image: p.image, meta: p.meta, color: p.color });

  async function selectFeatured({ pick = randomPick } = {}) {
    if (!eligibleCache) eligibleCache = await buildEligible();
    if (eligibleCache.length === 0) throw new Error('No artwork available');

    const chosen = pick(eligibleCache);
    const p1 = await resolveFolder(chosen);

    if (chosen.kind === 'landscape') {
      return { mode: 'single', matte: matteFromAvgs([p1.avg]), panels: [panelOut(p1)] };
    }

    const portraits = eligibleCache.filter((e) => e.kind === 'portrait');
    const companion = pickCompanion(chosen, portraits, pick);
    if (!companion) {
      return { mode: 'single', matte: matteFromAvgs([p1.avg]), panels: [panelOut(p1)] };
    }
    let p2;
    try {
      p2 = await resolveFolder(companion);
    } catch (err) {
      logger.warn?.('art.companion.failed', { folder: companion.folder, error: err.message });
      return { mode: 'single', matte: matteFromAvgs([p1.avg]), panels: [panelOut(p1)] };
    }
    return {
      mode: 'diptych',
      matte: matteFromAvgs([p1.avg, p2.avg]),
      panels: [panelOut(p1), panelOut(p2)],
    };
  }

  return { selectFeatured };
}

export default createArtAdapter;
