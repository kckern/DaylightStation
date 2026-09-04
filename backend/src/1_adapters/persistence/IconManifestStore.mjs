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
import { fileExists } from '#system/utils/FileIO.mjs';

/** The ONLY shape a requestable icon slug may take. Never loosened. */
export const ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** The only extensions this store will hand to a serving route, and their types. */
const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const MANIFEST_ADDRESS = 'apps/health/icon-manifest';

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
}

export default IconManifestStore;
