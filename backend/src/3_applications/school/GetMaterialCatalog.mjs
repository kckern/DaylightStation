/**
 * GetMaterialCatalog — the catalog grid use-case (spec §2, §3, §7). Walks
 * every configured `materials.sources` entry, calls that source's
 * `listMaterials(root)`, and stamps each result with the category it
 * resolves to (`2_domains/school/categories.mjs`, fail-closed to `reference`
 * with a warning). A source entry whose adapter throws is logged and skipped
 * — one bad Plex root must not blank the whole catalog for every other
 * section.
 *
 * `listMaterials` results are cached in-memory per root for 60s (`#ttlMs`),
 * shared by `execute()` and `findMaterial()`, so that `GetMaterialUnits`
 * (Task 4) and repeated catalog renders don't fan out duplicate Plex calls —
 * "Plex requests serialize app-wide" (CLAUDE.local.md), so cheap reads matter.
 * `now` is injectable for testability; production leaves it at the `Date.now`
 * default (the only place in this module a wall clock is read).
 */
import { resolveCategory } from '#domains/school/index.mjs';

const SECTION_ORDER = [
  { category: 'course', label: 'Courses' },
  { category: 'reference', label: 'Reference' },
  { category: 'listening', label: 'Listening' },
];

const TTL_MS = 60_000;

export class GetMaterialCatalog {
  #sources;
  #config;
  #logger;
  #now;
  #cache = new Map(); // root -> { materials: Material[]<no category>, at: number }

  constructor({ sources, config, logger = console, now = () => Date.now() }) {
    this.#sources = sources;
    this.#config = config;
    this.#logger = logger;
    this.#now = now;
  }

  async #listMaterialsCached(entry) {
    const cached = this.#cache.get(entry.root);
    const nowTs = this.#now();
    if (cached && nowTs - cached.at < TTL_MS) return cached.materials;

    const adapter = this.#sources[entry.source];
    if (!adapter) throw new Error(`no source adapter registered for "${entry.source}"`);
    const materials = await adapter.listMaterials(entry.root);
    this.#cache.set(entry.root, { materials, at: nowTs });
    return materials;
  }

  #stamp(material, entry) {
    const { key: category } = resolveCategory(entry.category, { logger: this.#logger, sourceLabel: entry.label });
    return {
      ...material,
      source: entry.source,
      medium: entry.medium ?? material.medium,
      category,
      // School subject shelf — config-declared per source, unvalidated here:
      // the frontend routes unknowns to Library. `subject_overrides` maps a
      // material id to its own shelf, for mixed-subject roots (one Plex
      // collection holding a money show and a science show); the source-level
      // `subject` remains the default for everything unlisted.
      subject: entry.subject_overrides?.[material.id] ?? entry.subject ?? null,
    };
  }

  /**
   * @returns {Promise<{sections: Array<{category:string,label:string}>, materials: Array}>}
   */
  async execute() {
    const materials = [];
    const categoriesPresent = new Set();

    for (const entry of this.#config.sources) {
      let raw;
      try {
        raw = await this.#listMaterialsCached(entry);
      } catch (err) {
        this.#logger.error?.('school.materials.source-failed', { source: entry.label, root: entry.root, error: err.message });
        continue;
      }
      for (const material of raw) {
        const stamped = this.#stamp(material, entry);
        materials.push(stamped);
        categoriesPresent.add(stamped.category);
      }
    }

    const sections = SECTION_ORDER.filter((s) => categoriesPresent.has(s.category));
    return { sections, materials };
  }

  /**
   * Walks configured roots' (cached) `listMaterials` looking for `materialId`.
   * Returns `{ entry, material }` (the stamped, unit-less material) or `null`.
   *
   * @param {string} materialId
   * @returns {Promise<{entry:object, material:object}|null>}
   */
  async findMaterial(materialId) {
    for (const entry of this.#config.sources) {
      let raw;
      try {
        raw = await this.#listMaterialsCached(entry);
      } catch (err) {
        this.#logger.error?.('school.materials.source-failed', { source: entry.label, root: entry.root, error: err.message });
        continue;
      }
      const hit = raw.find((m) => m.id === materialId);
      if (hit) return { entry, material: this.#stamp(hit, entry) };
    }
    return null;
  }
}

export default GetMaterialCatalog;
