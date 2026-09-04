/**
 * IconManifestStore - resolves a food-icon slug to a file on the media mount.
 * @module adapters/persistence/IconManifestStore
 *
 * The manifest is the SINGLE icon vocabulary (PRD F5.1). It is hand-reviewed,
 * drafted by `cli/curate-nutrition-icons.mjs`, and lives in the data mount at
 * `data/household/apps/health/icon-manifest.yml`:
 *
 *   icons:                       # the OFFERED vocabulary
 *     carrot: { path: img/nutrition/icons/vegetables/carrot.png }
 *   aliases:                     # resolvable, never offered
 *     apple_sauce: { path: img/icons/food/apple_sauce.png }
 *
 * `icons` is what the parse agent chooses from and what the picker lists.
 * `aliases` exist because nutribot's original flat slugs are ALREADY STORED on
 * rows as `FoodItem.icon`; dropping one would silently break a stored row
 * (it renders its fallback glyph, and nothing logs). Renames happen by editing
 * a path here, never by moving files and hoping the code follows.
 *
 * Filenames live in the manifest, never in code (household rule: no hardcoded
 * asset paths). An unmapped id resolves to null and the caller renders the
 * neutral fallback.
 *
 * Security: `slug` arrives from a URL path segment and is joined against a
 * filesystem root, so it is gated the way PhotoStore gates `photoRef` —
 * a strict allowlist BEFORE the slug takes part in any lookup, then a resolved-
 * path containment check AFTER the join. Critically, the slug is NEVER
 * concatenated onto a path: it can only select a manifest ENTRY, and the entry's
 * own path is validated independently (no absolute paths, no `..` segments, a
 * closed extension allowlist, plus containment) so a bad manifest cannot escape
 * either. A `..` cannot reach the filesystem through any of those doors.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { Jimp } from 'jimp';
import { ensureDir, fileExists, getFileStats, writeFileAtomic } from '#system/utils/FileIO.mjs';

/** The ONLY shape a requestable icon slug may take. Never loosened. */
export const ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** The only extensions this store will hand to a serving route, and their types. */
const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const MANIFEST_ADDRESS = 'apps/health/icon-manifest';

/**
 * The hi-res source art averages ~3 MB per file (median 3.0 MB; 528 of 534
 * offered icons exceed 1 MB). A row renders one at 24 CSS px and the edit
 * sheet's picker shows up to 60 at once, so serving the sources verbatim would
 * cost tens of megabytes for a day's log and well over a hundred for one open
 * picker. Every request therefore serves a downscaled derivative, cached on
 * disk under the DATA mount — never written back into `media/`, which is
 * Dropbox-synced and is read-only as far as this app is concerned.
 *
 * 96px covers both consumers at 2x device pixel ratio (24 CSS px row icon,
 * 40 CSS px picker cell).
 */
const RENDER_WIDTH_PX = 96;
const RENDER_CACHE_DIR = 'apps/health/icon-cache';

export function isValidIconSlug(slug) {
  return typeof slug === 'string' && ICON_SLUG_PATTERN.test(slug);
}

export class IconManifestStore {
  #dataService;
  #mediaRoot;
  #logger;
  #loaded = false;
  #icons = {};
  #aliases = {};
  #cacheDir = null;
  #cacheDirResolved = false;

  /**
   * @param {Object} options
   * @param {Object} options.dataService - DataService (uses .household.read)
   * @param {string} options.mediaRoot - absolute media directory (ConfigService.getMediaDir())
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    if (!options.dataService) throw new Error('IconManifestStore requires dataService');
    if (!options.mediaRoot) throw new Error('IconManifestStore requires mediaRoot');
    this.#dataService = options.dataService;
    this.#mediaRoot = path.resolve(options.mediaRoot);
    this.#logger = options.logger || console;
  }

  /**
   * Read the manifest once. A missing or malformed manifest yields an EMPTY
   * vocabulary rather than a throw: icons are decoration, and a household that
   * has not installed one must still be able to log food. It is logged at warn
   * so the absence is visible rather than silent.
   */
  #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    let raw = null;
    try {
      raw = this.#dataService.household?.read?.(MANIFEST_ADDRESS) ?? null;
    } catch (e) {
      this.#logger.warn?.('health.icons.manifest.read_failed', { error: e.message });
      return;
    }
    if (!raw || typeof raw !== 'object') {
      this.#logger.warn?.('health.icons.manifest.missing', { address: MANIFEST_ADDRESS });
      return;
    }
    this.#icons = raw.icons && typeof raw.icons === 'object' ? raw.icons : {};
    this.#aliases = raw.aliases && typeof raw.aliases === 'object' ? raw.aliases : {};
    this.#logger.info?.('health.icons.manifest.loaded', {
      icons: Object.keys(this.#icons).length,
      aliases: Object.keys(this.#aliases).length,
    });
  }

  /** Re-read the manifest on the next access (after an operator edits it). */
  reload() {
    this.#loaded = false;
    this.#icons = {};
    this.#aliases = {};
  }

  /** The OFFERED vocabulary, sorted. Aliases are deliberately excluded. */
  list() {
    this.#load();
    return Object.keys(this.#icons).sort();
  }

  /** True when the slug resolves at all (primary or alias). */
  has(slug) {
    this.#load();
    if (!isValidIconSlug(slug)) return false;
    return Boolean(this.#icons[slug] || this.#aliases[slug]);
  }

  /**
   * Substring search over the offered vocabulary, for the picker.
   * @param {string} query
   * @param {number} [limit=60]
   * @returns {string[]}
   */
  search(query, limit = 60) {
    const q = typeof query === 'string' ? query.toLowerCase().trim() : '';
    const all = this.list();
    return (q ? all.filter((slug) => slug.includes(q)) : all).slice(0, Math.max(0, limit));
  }

  /**
   * Resolve a slug to a file on disk.
   *
   * Returns null (never throws) when the slug fails the allowlist, is absent
   * from the manifest, names a path that escapes the media root or has a
   * disallowed extension, or names a file that is not there — the last case
   * being what a Dropbox conflicted copy that emptied a folder looks like.
   *
   * @param {string} slug
   * @returns {{ slug: string, absolutePath: string, contentType: string }|null}
   */
  resolve(slug) {
    // 1) Strict allowlist BEFORE the slug is used for anything at all.
    if (!isValidIconSlug(slug)) return null;

    this.#load();
    const entry = this.#icons[slug] || this.#aliases[slug] || null;
    if (!entry || typeof entry.path !== 'string' || !entry.path) return null;

    // 2) The manifest's own path is validated independently of the slug. A
    //    reviewed file should never contain these, so a hit is a manifest bug
    //    worth logging rather than a silent skip.
    const relative = entry.path;
    if (path.isAbsolute(relative) || relative.split(/[/\\]/).includes('..')) {
      this.#logger.warn?.('health.icons.manifest.unsafe_path', { slug, path: relative });
      return null;
    }
    const contentType = CONTENT_TYPES[path.extname(relative).toLowerCase()];
    if (!contentType) {
      this.#logger.warn?.('health.icons.manifest.unsupported_type', { slug, path: relative });
      return null;
    }

    // 3) Belt-and-braces containment AFTER the join, independent of (2).
    const candidate = path.resolve(this.#mediaRoot, relative);
    if (candidate !== this.#mediaRoot && !candidate.startsWith(this.#mediaRoot + path.sep)) {
      this.#logger.warn?.('health.icons.manifest.escapes_root', { slug, path: relative });
      return null;
    }

    if (!fileExists(candidate)) return null;
    return { slug, absolutePath: candidate, contentType };
  }

  /** Where derivatives live, under the DATA mount. Never inside `media/`. */
  #renderCacheDir() {
    if (this.#cacheDirResolved) return this.#cacheDir;
    this.#cacheDirResolved = true;
    try {
      this.#cacheDir = this.#dataService.household?.resolveDir?.(RENDER_CACHE_DIR) ?? null;
    } catch (e) {
      this.#logger.warn?.('health.icons.cache.unresolvable', { error: e.message });
      this.#cacheDir = null;
    }
    return this.#cacheDir;
  }

  /**
   * Resolve a slug to a SERVABLE file: the downscaled derivative, generated once
   * and cached on disk.
   *
   * The cache key carries the source's resolved path, its size and its mtime, so
   * repointing a slug in the manifest — or editing the file under it — produces a
   * new key rather than serving a stale picture. Old entries are simply orphaned;
   * nothing sweeps them, and at ~4 KB each that is not worth a reaper.
   *
   * Fails SOFT in every direction: no cache directory, an unreadable source, a
   * jimp decode failure, or an unwritable cache all fall back to serving the
   * original file. An icon is decoration — it must never be the reason a row
   * cannot render — and the caller still gets a real image.
   *
   * @param {string} slug
   * @returns {Promise<{ slug: string, absolutePath: string, contentType: string }|null>}
   */
  async resolveRendered(slug) {
    const hit = this.resolve(slug);
    if (!hit) return null;

    const dir = this.#renderCacheDir();
    if (!dir) return hit;

    let stats;
    try {
      stats = getFileStats(hit.absolutePath);
    } catch {
      return hit;
    }
    if (!stats) return hit;

    const fingerprint = createHash('sha256')
      .update(`${hit.absolutePath}:${stats.size}:${Math.round(stats.mtimeMs)}:${RENDER_WIDTH_PX}`)
      .digest('hex')
      .slice(0, 12);
    // The slug is already through the allowlist by this point (`resolve` returned),
    // so it cannot contain a separator; the fingerprint is hex. The join is
    // therefore over two known-safe segments.
    const cached = path.join(dir, `${slug}.${fingerprint}.png`);
    if (fileExists(cached)) return { slug, absolutePath: cached, contentType: 'image/png' };

    try {
      ensureDir(dir);
      const image = await Jimp.read(hit.absolutePath);
      if (image.bitmap.width > RENDER_WIDTH_PX) image.resize({ w: RENDER_WIDTH_PX });
      const buffer = await image.getBuffer('image/png');
      // Atomic: two concurrent requests for the same icon race here, and both
      // write byte-identical output, so last-writer-wins is correct — but a
      // half-written file being served is not.
      writeFileAtomic(cached, buffer);
      this.#logger.debug?.('health.icons.render.cached', {
        slug, sourceBytes: stats.size, renderedBytes: buffer.length,
      });
      return { slug, absolutePath: cached, contentType: 'image/png' };
    } catch (e) {
      this.#logger.warn?.('health.icons.render.failed', { slug, error: e.message });
      return hit;
    }
  }
}

export default IconManifestStore;
