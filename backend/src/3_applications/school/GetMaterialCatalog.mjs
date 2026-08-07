/**
 * GetMaterialCatalog — the catalog grid use-case (spec §2, §3, §7). Walks
 * every configured `materials.sources` entry, calls that source's
 * `listMaterials(root)`, and stamps each result with the category it
 * resolves to (`2_domains/school/categories.mjs`, fail-closed to `reference`
 * with a warning). A source entry whose adapter throws is logged and skipped
 * — one unavailable media root must not blank the whole catalog for every other
 * section.
 *
 * `listMaterials` results are cached in-memory per root for 10 min (`TTL_MS`),
 * shared by `execute()` and `findMaterial()`, so that `GetMaterialUnits`
 * (Task 4) and repeated catalog renders don't fan out duplicate provider calls.
 * `now` is injectable for testability; production leaves it at the `Date.now`
 * default (the only place in this module a wall clock is read).
 */
import { resolveCategory } from '#domains/school/index.mjs';
import { isVisibleAtCeiling } from '#domains/school/grades.mjs';

const SECTION_ORDER = [
  { category: 'course', label: 'Courses' },
  { category: 'reference', label: 'Reference' },
  { category: 'listening', label: 'Listening' },
];

// Keep the catalog warm well past a single subject visit so users rarely pay a
// cold rebuild (the homeschool catalog changes rarely — minutes of staleness is
// fine). Combined with a boot pre-warm (app.mjs), a redeploy no longer strands
// the first visitor on a cold, slow build.
const TTL_MS = 600_000; // 10 min
// A single remote `listMaterials` may stall (provider busy / TCP keepalive).
// With no bound, the whole catalog build hangs — blocking the app. Cap each
// source so a true stall rejects and the source is skipped (fail-soft). The cap
// must be generous: a label source can make several provider calls and be slow
// but VALID, so too-short a bound wrongly drops whole subjects (scripture went
// empty at 8s). 25s covers a slow-but-working source while still bounding a hang.
const SOURCE_TIMEOUT_MS = 25_000;

export class GetMaterialCatalog {
  #sources;
  #config;
  #logger;
  #now;
  #sourceTimeoutMs;
  #cache = new Map(); // source+root -> { materials: Material[]<no category>, at: number }
  #inflight = new Map(); // source+root -> Promise, so a stampede doesn't fan out N cold builds

  constructor({ sources, config, logger = console, now = () => Date.now(), sourceTimeoutMs = SOURCE_TIMEOUT_MS }) {
    this.#sources = sources;
    this.#config = config;
    this.#logger = logger;
    this.#now = now;
    this.#sourceTimeoutMs = sourceTimeoutMs;
  }

  #withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`listMaterials("${label}") timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  async #listMaterialsCached(entry) {
    const key = `${entry.source}:${entry.root}`;
    const cached = this.#cache.get(key);
    const nowTs = this.#now();
    if (cached && nowTs - cached.at < TTL_MS) return cached.materials;

    // Coalesce concurrent cold fetches for the same root — one build, many
    // awaiters — so a stampede of subject opens doesn't multiply the fan-out.
    const existing = this.#inflight.get(key);
    if (existing) return existing;

    const adapter = this.#sources[entry.source];
    if (!adapter) throw new Error(`no source adapter registered for "${entry.source}"`);

    const p = this.#withTimeout(adapter.listMaterials(entry.root), this.#sourceTimeoutMs, entry.label)
      .then((materials) => {
        this.#cache.set(key, { materials, at: this.#now() });
        return materials;
      })
      .finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, p);
    return p;
  }

  #stamp(material, entry) {
    const { key: category } = resolveCategory(entry.category, { logger: this.#logger, sourceLabel: entry.label });
    return {
      ...material,
      source: entry.source,
      medium: entry.medium ?? material.medium,
      category,
      kind: material.kind ?? 'material',
      // A collection's own name is the configured source `label`; works and
      // plain materials keep their provider title.
      title: material.kind === 'collection' ? (entry.label ?? material.title) : material.title,
      // School subject shelf — config-declared per source, unvalidated here:
      // the frontend routes unknowns to Library. `subject_overrides` maps a
      // material id to its own shelf, for mixed-subject roots (one media
      // collection holding a money show and a science show); the source-level
      // `subject` remains the default for everything unlisted.
      // A `media-label` material carries its own `subject` label; used only when
      // config declares no shelf, so an explicit config subject still wins.
      subject: entry.subject_overrides?.[material.id] ?? entry.subject ?? material.subject ?? null,
    };
  }

  /**
   * A collection's works (albums), stamped with the collection's category/
   * subject so a work inherits the anthology's pedagogy (quiz gating, credit).
   * Sources without a `listWorks` capability return no works.
   *
   * @param {string} collectionId - the opaque collection material id
   * @returns {Promise<Array>} stamped work materials, or [] if not a collection
   */
  async listWorks(collectionId) {
    for (const entry of this.#config.sources) {
      const adapter = this.#sources[entry.source];
      if (!adapter?.listWorks) continue;
      // eslint-disable-next-line no-await-in-loop
      const roots = await this.#listMaterialsCached(entry);
      if (!roots.some((material) => material.id === collectionId)) continue;
      // eslint-disable-next-line no-await-in-loop
      const works = await adapter.listWorks(entry.root);
      return works.map((work) => this.#stamp(work, entry));
    }
    return [];
  }

  /**
   * @returns {Promise<{sections: Array<{category:string,label:string}>, materials: Array}>}
   */
  async execute() {
    const materials = [];
    const categoriesPresent = new Set();

    // Fetch sources in PARALLEL (order preserved) so a single slow/timed-out
    // source bounds the whole build to ~one source-timeout rather than the sum
    // of every source. Each source still fail-soft: a throw/timeout logs and
    // contributes nothing, never blanking the rest of the catalog.
    const perSource = await Promise.all(this.#config.sources.map(async (entry) => {
      try {
        return { entry, raw: await this.#listMaterialsCached(entry) };
      } catch (err) {
        this.#logger.error?.('school.materials.source-failed', { source: entry.label, root: entry.root, error: err.message });
        return { entry, raw: [] };
      }
    }));

    for (const { entry, raw } of perSource) {
      for (const material of raw) {
        const stamped = this.#stamp(material, entry);
        // Household grade ceiling: a material labelled above the household's
        // current level stays authored-but-dormant (grades.mjs). Absence of a
        // min-grade, or of a ceiling, never hides.
        if (!isVisibleAtCeiling(stamped.minGrade ?? null, this.#config.visibleGradeCeiling ?? null)) continue;
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
    // Top-level items first (series, collections, or other source materials).
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
    // Then a work INSIDE a collection — `listMaterials` returns the collection,
    // not its works, so a work (album) id is resolved one level down. It
    // inherits its collection source's entry (category, subject) via #stamp.
    for (const entry of this.#config.sources) {
      const adapter = this.#sources[entry.source];
      if (!adapter?.listWorks) continue;
      try {
        const works = await adapter.listWorks(entry.root);
        const hit = works.find((w) => w.id === materialId);
        if (hit) return { entry, material: this.#stamp(hit, entry) };
      } catch (err) {
        this.#logger.error?.('school.materials.works-failed', { source: entry.label, root: entry.root, error: err.message });
      }
    }
    return null;
  }
}

export default GetMaterialCatalog;
