// artSource.mjs — resolves an `art` collection def into normalized candidates.
// Scans media/img/art/<scope>/<work>/, reads metadata.yaml, classifies aspect,
// applies the collection predicate. Each candidate exposes loadImage() → Jimp.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Jimp } from 'jimp';
import { buildArtPredicate } from '../collections.mjs';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
// Orientation split: anything at least as wide as it is tall hangs as a single
// landscape; only true portraits (taller than wide) are eligible to pair into a
// diptych. Near-square works (e.g. ratio ~1.3) are landscapes, not portraits.
const PORTRAIT_RATIO = 1;
const MAX_RATIO = 16 / 9;
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

// Encode each path segment but keep the slashes between them.
const encodeSegments = (rel) => rel.split('/').map(encodeURIComponent).join('/');

export function createArtSource({ imgBasePath, logger = console }) {
  // Scope-level scan cache: a collection resolves over one scope directory
  // (art/classic or art/<folder>), and the screensaver re-resolves on EVERY art
  // advance. Scanning 550 work folders (readdir + readMeta + findImageFile each)
  // per advance is the dominant cost, so cache the raw per-folder scan keyed by
  // scopeDir. Invalidate on the scope dir's mtime — adding/removing a work folder
  // bumps the parent mtime (self-heals, matching the fitness-index pattern). The
  // collection predicate stays per-call (cheap, in-memory) so different
  // collections share one scan of the same scope.
  const scanCache = new Map();   // scopeDir → { mtimeMs, entries }

  async function readMeta(dir) {
    try {
      const raw = await fs.readFile(path.join(dir, 'metadata.yaml'), 'utf-8');
      const p = yaml.load(raw) || {};
      return {
        title: p.title ?? null, artist: p.artist ?? null,
        date: p.date != null ? String(p.date) : null,
        origin: p.origin ?? null, medium: p.medium ?? null,
        department: p.department ?? null, credit: p.credit ?? null,
        category: p.category ?? null, display: p.display ?? null,
        width: toInt(p.width), height: toInt(p.height),
      };
    } catch (err) {
      logger.warn?.('art.metadata.missing', { dir, error: err.message });
      return null;
    }
  }

  async function findImageFile(dir) {
    const files = await fs.readdir(dir);
    return files.find(
      (f) => !f.startsWith('.') && IMAGE_EXTS.includes(path.extname(f).toLowerCase())
    ) || null;
  }

  // Scan a scope directory into raw per-folder entries (meta + image + kind),
  // before any collection predicate. Cached by scopeDir mtime.
  async function scanScope(scope, scopeDir) {
    let stat;
    try {
      stat = await fs.stat(scopeDir);
    } catch (err) {
      logger.warn?.('art.scope.unreadable', { scope, error: err.message });
      return [];
    }
    const cached = scanCache.get(scopeDir);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.entries;

    const dirents = await fs.readdir(scopeDir, { withFileTypes: true });
    const folders = dirents.filter((e) => e.isDirectory()).map((e) => e.name);
    const entries = [];
    for (const folder of folders) {
      const dir = path.join(scopeDir, folder);
      const meta = await readMeta(dir);
      if (!meta || !meta.width || !meta.height) continue;
      const ratio = meta.width / meta.height;
      if (ratio > MAX_RATIO) continue;                       // panoramic excluded
      const imageFile = await findImageFile(dir);
      if (!imageFile) { logger.warn?.('art.image.missing', { folder }); continue; }
      const kind = ratio >= PORTRAIT_RATIO ? 'landscape' : 'portrait';
      entries.push({
        folder,
        meta,                                                 // full meta (predicate reads category/display)
        kind,
        image: `/media/img/${encodeSegments(`${scope}/${folder}/${imageFile}`)}`,
        localPath: path.join(dir, imageFile),
      });
    }
    scanCache.set(scopeDir, { mtimeMs: stat.mtimeMs, entries });
    logger.info?.('art.source.scanned', { scope, count: entries.length });
    return entries;
  }

  async function resolveCandidates(def = {}) {
    const scope = def.folder ? `art/${def.folder}` : 'art/classic';
    const scopeDir = path.join(imgBasePath, scope);
    const predicate = buildArtPredicate(def);

    const scanned = await scanScope(scope, scopeDir);
    const out = [];
    for (const e of scanned) {
      if (!predicate({ folder: e.folder, meta: e.meta })) continue;
      const { meta } = e;
      out.push({
        id: e.folder,
        image: e.image,
        width: meta.width, height: meta.height, kind: e.kind,
        meta: {
          title: meta.title, artist: meta.artist, date: meta.date,
          origin: meta.origin, medium: meta.medium,
          department: meta.department, credit: meta.credit,
          // width/height feed the frontend artLayout aspect-ratio math.
          width: meta.width, height: meta.height,
        },
        loadImage: () => Jimp.read(e.localPath),
      });
    }
    logger.info?.('art.source.resolved', { scope, count: out.length });
    return out;
  }

  return { resolveCandidates };
}

export default createArtSource;
