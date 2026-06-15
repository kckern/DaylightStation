// artSource.mjs — resolves an `art` collection def into normalized candidates.
// Scans media/img/art/<scope>/<work>/, reads metadata.yaml, classifies aspect,
// applies the collection predicate. Each candidate exposes loadImage() → Jimp.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Jimp } from 'jimp';
import { buildArtPredicate } from '../collections.mjs';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIN_RATIO = 4 / 3;
const MAX_RATIO = 16 / 9;
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

// Encode each path segment but keep the slashes between them.
const encodeSegments = (rel) => rel.split('/').map(encodeURIComponent).join('/');

export function createArtSource({ imgBasePath, logger = console }) {
  async function readMeta(dir) {
    try {
      const raw = await fs.readFile(path.join(dir, 'metadata.yaml'), 'utf-8');
      const p = yaml.load(raw) || {};
      return {
        title: p.title ?? null, artist: p.artist ?? null,
        date: p.date != null ? String(p.date) : null,
        origin: p.origin ?? null, medium: p.medium ?? null,
        department: p.department ?? null, credit: p.credit ?? null,
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

  async function resolveCandidates(def = {}) {
    const scope = def.folder ? `art/${def.folder}` : 'art/classic';
    const scopeDir = path.join(imgBasePath, scope);
    const predicate = buildArtPredicate(def);

    let entries;
    try {
      entries = await fs.readdir(scopeDir, { withFileTypes: true });
    } catch (err) {
      logger.warn?.('art.scope.unreadable', { scope, error: err.message });
      return [];
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const out = [];
    for (const folder of folders) {
      const dir = path.join(scopeDir, folder);
      const meta = await readMeta(dir);
      if (!meta || !meta.width || !meta.height) continue;
      const ratio = meta.width / meta.height;
      if (ratio > MAX_RATIO) continue;                       // panoramic excluded
      const entry = { folder, meta };
      if (!predicate(entry)) continue;
      const imageFile = await findImageFile(dir);
      if (!imageFile) { logger.warn?.('art.image.missing', { folder }); continue; }
      const kind = ratio >= MIN_RATIO ? 'landscape' : 'portrait';
      const localPath = path.join(dir, imageFile);
      out.push({
        id: folder,
        image: `/media/img/${encodeSegments(`${scope}/${folder}/${imageFile}`)}`,
        width: meta.width, height: meta.height, kind,
        meta: {
          title: meta.title, artist: meta.artist, date: meta.date,
          origin: meta.origin, medium: meta.medium,
          department: meta.department, credit: meta.credit,
        },
        loadImage: () => Jimp.read(localPath),
      });
    }
    logger.info?.('art.source.resolved', { scope, count: out.length });
    return out;
  }

  return { resolveCandidates };
}

export default createArtSource;
