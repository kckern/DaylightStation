/**
 * YamlFoodCatalogDatastore - YAML persistence for food catalog.
 *
 * Storage: data/users/{username}/lifelog/nutrition/food_catalog.yml
 * Format: Array of FoodCatalogEntry objects.
 */

import { IFoodCatalogDatastore } from '#apps/health/ports/IFoodCatalogDatastore.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { randomUUID } from 'node:crypto';
import { readHealthYaml, writeHealthYaml } from './healthYaml.mjs';

export class YamlFoodCatalogDatastore extends IFoodCatalogDatastore {
  #dataService;
  #logger;

  static CATALOG_PATH = 'lifelog/nutrition/food_catalog';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlFoodCatalogDatastore requires dataService');
    this.#dataService = config.dataService;
    this.#logger = config.logger || console;
  }

  // Storage -> Domain. The datastore owns hydration (adapter-layer-guidelines
  // Hydration Pattern); the entity no longer carries fromJSON.
  #hydrate(raw) {
    const now = new Date();
    return new FoodCatalogEntry({
      ...raw,
      id: raw.id || randomUUID(),
      lastUsed: raw.lastUsed || now.toISOString().slice(0, 10),
      createdAt: raw.createdAt || now.toISOString(),
    });
  }

  // Domain -> Storage. The ONLY place the on-disk catalog shape is defined.
  #dehydrate(entry) {
    return {
      id: entry.id,
      name: entry.name,
      normalizedName: entry.normalizedName,
      // Preserve source values and their portion basis; never feed a derived
      // serving back into the evidence on the next hydration.
      nutrients: { ...entry.baseNutrients },
      baseGrams: entry.baseGrams,
      microBasis: entry.microBasis,
      manualPortion: entry.manualPortion,
      // The evidence. A field missing from this dehydrator is a field that
      // silently does not survive a restart — the trap this program has now
      // hit four times — so the ring is written whole, per observation copied.
      observations: (entry.observations || []).map((o) => ({ ...o })),
      source: entry.source,
      barcodeUpc: entry.barcodeUpc,
      useCount: entry.useCount,
      // Per-bucket usage (Task 9.1). This is the ONLY place the on-disk catalog
      // shape is defined, so a field missing here is a field that silently does
      // not survive a restart — the trap this program has now hit four times.
      // Copied per bucket so the written object never aliases the entity's.
      usageByBucket: Object.fromEntries(
        Object.entries(entry.usageByBucket || {}).map(([bucket, usage]) => [bucket, { ...usage }]),
      ),
      favorite: entry.favorite === true,
      icon: entry.icon ?? null,
      lastUsed: entry.lastUsed,
      createdAt: entry.createdAt,
    };
  }

  #loadCatalog(userId) {
    const raw = readHealthYaml(this.#dataService, YamlFoodCatalogDatastore.CATALOG_PATH, userId);
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new Error('Saved foods could not be read: invalid catalog format.');
    return raw.map(item => this.#hydrate(item));
  }

  async #saveCatalog(entries, userId) {
    const data = entries.map(e => this.#dehydrate(e));
    return writeHealthYaml(this.#dataService, YamlFoodCatalogDatastore.CATALOG_PATH, userId, data, 'CATALOG_WRITE_FAILED');
  }

  async findByNormalizedName(name, userId) {
    const catalog = await this.#loadCatalog(userId);
    const normalized = FoodCatalogEntry.normalize(name);
    return catalog.find(e => e.matches(normalized)) || null;
  }

  async search(query, userId, limit = 10) {
    const catalog = await this.#loadCatalog(userId);
    return catalog
      .filter(e => e.matchesSearch(query))
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  async getRecent(userId, limit = 10) {
    const catalog = await this.#loadCatalog(userId);
    return catalog
      .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
      .slice(0, limit);
  }

  async save(entry, userId) {
    const catalog = this.#loadCatalog(userId);
    const idx = catalog.findIndex(e => e.id === entry.id);
    if (idx >= 0) {
      catalog[idx] = entry;
    } else {
      catalog.push(entry);
    }
    await this.#saveCatalog(catalog, userId);
  }

  async getById(id, userId) {
    const catalog = await this.#loadCatalog(userId);
    return catalog.find(e => e.id === id) || null;
  }

  async getAll(userId) {
    return this.#loadCatalog(userId);
  }

  async findByUpc(upc, userId) {
    if (!upc) return null;
    const catalog = await this.#loadCatalog(userId);
    return catalog.find(e => e.barcodeUpc === upc) || null;
  }

  /**
   * Permanently remove a catalog entry. Returns false when the id doesn't
   * exist (caller maps that to 404) rather than throwing — a missing entry
   * isn't a write failure. A write that DOES fail throws CATALOG_WRITE_FAILED,
   * mirroring the honest-write pattern in the other health datastores
   * (e.g. YamlMedicalReadingsDatastore).
   */
  async removeById(id, userId) {
    const catalog = this.#loadCatalog(userId);
    const idx = catalog.findIndex(e => e.id === id);
    if (idx < 0) return false;
    catalog.splice(idx, 1);
    await this.#saveCatalog(catalog, userId);
    return true;
  }
}
