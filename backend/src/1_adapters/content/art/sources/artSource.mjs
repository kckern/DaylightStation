// artSource.mjs — resolves an `art` collection def into normalized candidates.
// Scans media/img/art/<scope>/<work>/, reads metadata.yaml, classifies aspect,
// applies the collection predicate. Each candidate exposes loadImage() → Jimp.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Jimp } from 'jimp';
import { isMember } from '../collections.mjs';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Normalize a raw metadata `crop` into { enabled, top, bottom, left, right } or null.
// enabled defaults true when a crop object exists; margins are numbers or null.
function normalizeCrop(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    enabled: raw.enabled === false ? false : true,
    top: num(raw.top), bottom: num(raw.bottom),
    left: num(raw.left), right: num(raw.right),
  };
}

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

  // Project a scanned entry's meta for output (screensaver + admin share this).
  const projectMeta = (meta) => ({
    title: meta.title, artist: meta.artist, date: meta.date,
    origin: meta.origin, medium: meta.medium,
    department: meta.department, credit: meta.credit,
    category: meta.category ?? null, display: meta.display ?? null,
    section: meta.section ?? null, crop_anchor: meta.crop_anchor ?? null,
    tags: meta.tags ?? [], exclude: meta.exclude ?? [],
    hidden: meta.hidden === true, flagged: meta.flagged === true,
    crop: meta.crop ?? null,
    width: meta.width, height: meta.height,
  });

  async function readMeta(dir) {
    let raw;
    try {
      raw = await fs.readFile(path.join(dir, 'metadata.yaml'), 'utf-8');
    } catch (err) {
      // No metadata.yaml here. With sectioned scopes (art/<scope>/<section>/<work>/)
      // a missing file just means "this dir is a section, not a work" — that is
      // normal, so stay quiet on ENOENT and let the caller recurse one level.
      if (err.code !== 'ENOENT') logger.warn?.('art.metadata.unreadable', { dir, error: err.message });
      return null;
    }
    try {
      const p = yaml.load(raw) || {};
      const arr = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v]));
      return {
        title: p.title ?? null, artist: p.artist ?? null,
        date: p.date != null ? String(p.date) : null,
        origin: p.origin ?? null, medium: p.medium ?? null,
        department: p.department ?? null, credit: p.credit ?? null,
        category: p.category ?? null, display: p.display ?? null,
        crop_anchor: p.crop_anchor ?? null,
        // Hand-curation (ArtMode admin). tags/exclude are collection-name lists.
        tags: arr(p.tags), exclude: arr(p.exclude),
        hidden: p.hidden === true, flagged: p.flagged === true,
        crop: normalizeCrop(p.crop),
        width: toInt(p.width), height: toInt(p.height),
      };
    } catch (err) {
      logger.warn?.('art.metadata.invalid', { dir, error: err.message });
      return null;
    }
  }

  async function findImageFile(dir) {
    const files = await fs.readdir(dir);
    return files.find(
      (f) => !f.startsWith('.') && IMAGE_EXTS.includes(path.extname(f).toLowerCase())
    ) || null;
  }

  // Read one work folder (given relative to scope) into a raw entry, or null if
  // it isn't a valid work — no metadata, missing dimensions, panoramic, or no
  // image. `section` is the immediate parent folder under the scope (null for a
  // depth-1 work) and is surfaced as meta.section so collections can scope to a
  // thematic subdir without colliding with metadata.yaml's medium-derived
  // `category` field.
  async function readWork(scope, scopeDir, relFolder, section = null) {
    const dir = path.join(scopeDir, relFolder);
    const meta = await readMeta(dir);
    if (!meta || !meta.width || !meta.height) return null;
    const ratio = meta.width / meta.height;
    if (ratio > MAX_RATIO) return null;                      // panoramic excluded
    const imageFile = await findImageFile(dir);
    if (!imageFile) { logger.warn?.('art.image.missing', { folder: relFolder }); return null; }
    const kind = ratio >= PORTRAIT_RATIO ? 'landscape' : 'portrait';
    return {
      folder: relFolder,                                     // unique id; may include the section path
      kind,
      meta: { ...meta, section },                            // predicate reads category/display/section
      image: `/media/img/${encodeSegments(`${scope}/${relFolder}/${imageFile}`)}`,
      localPath: path.join(dir, imageFile),
    };
  }

  // True when every cached section subdir still has its recorded mtime. A work
  // added/removed inside a section bumps that section's mtime but NOT the parent
  // scope's, so the scope-mtime check alone would miss it — re-verify the few
  // section dirs (flat scopes have none, so this is a no-op there).
  async function sectionsUnchanged(sections) {
    for (const [dir, mtimeMs] of sections) {
      try {
        const s = await fs.stat(dir);
        if (s.mtimeMs !== mtimeMs) return false;
      } catch { return false; }                              // section vanished → rescan
    }
    return true;
  }

  // Scan a scope directory into raw per-folder entries (meta + image + kind),
  // before any collection predicate. Scopes may be flat (art/<scope>/<work>/) or
  // sectioned (art/<scope>/<section>/<work>/); a direct child is treated as a
  // work when it carries metadata.yaml, otherwise as a section to recurse into
  // one level. Cached by scopeDir mtime plus the mtimes of discovered sections.
  async function scanScope(scope, scopeDir) {
    let stat;
    try {
      stat = await fs.stat(scopeDir);
    } catch (err) {
      logger.warn?.('art.scope.unreadable', { scope, error: err.message });
      return [];
    }
    const cached = scanCache.get(scopeDir);
    if (cached && cached.mtimeMs === stat.mtimeMs && await sectionsUnchanged(cached.sections)) {
      return cached.entries;
    }

    const dirents = await fs.readdir(scopeDir, { withFileTypes: true });
    const childDirs = dirents.filter((e) => e.isDirectory()).map((e) => e.name);
    const entries = [];
    const sections = new Map();                              // sectionDir → mtimeMs
    for (const child of childDirs) {
      const work = await readWork(scope, scopeDir, child);   // depth-1 work?
      if (work) { entries.push(work); continue; }
      // Not a work → treat as a section folder and scan its works one level down.
      const childDir = path.join(scopeDir, child);
      let subDirents;
      try {
        subDirents = await fs.readdir(childDir, { withFileTypes: true });
      } catch { continue; }
      try { sections.set(childDir, (await fs.stat(childDir)).mtimeMs); } catch { /* skip */ }
      for (const sub of subDirents.filter((e) => e.isDirectory()).map((e) => e.name)) {
        const nested = await readWork(scope, scopeDir, path.join(child, sub), child);
        if (nested) entries.push(nested);
      }
    }
    scanCache.set(scopeDir, { mtimeMs: stat.mtimeMs, sections, entries });
    logger.info?.('art.source.scanned', { scope, count: entries.length, sections: sections.size });
    return entries;
  }

  async function resolveCandidates(def = {}, key = 'all') {
    const scope = def.folder ? `art/${def.folder}` : 'art/classic';
    const scopeDir = path.join(imgBasePath, scope);

    const scanned = await scanScope(scope, scopeDir);
    const out = [];
    for (const e of scanned) {
      if (!isMember(key, def, { folder: e.folder, meta: e.meta })) continue;
      out.push({
        id: e.folder, image: e.image,
        width: e.meta.width, height: e.meta.height, kind: e.kind,
        meta: projectMeta(e.meta),
        loadImage: () => Jimp.read(e.localPath),
      });
    }
    logger.info?.('art.source.resolved', { scope, key, count: out.length });
    return out;
  }

  // Admin listing: every work in a scope with full curation meta, regardless of
  // rules/hidden/flagged. No loadImage (admin needs only id/image/meta).
  async function listWorks({ folder } = {}) {
    const scope = folder ? `art/${folder}` : 'art/classic';
    const scanned = await scanScope(scope, path.join(imgBasePath, scope));
    return scanned.map((e) => ({ id: e.folder, image: e.image, meta: projectMeta(e.meta) }));
  }

  return { resolveCandidates, listWorks };
}

export default createArtSource;
