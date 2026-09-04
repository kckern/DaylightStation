/**
 * YamlFoodCatalogDatastore - YAML persistence for food catalog.
 *
 * Storage: data/users/{username}/lifelog/nutrition/food_catalog.yml
 * Format: Array of FoodCatalogEntry objects.
 */

import { IFoodCatalogDatastore } from '#apps/health/ports/IFoodCatalogDatastore.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { randomUUID } from 'node:crypto';

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
      nutrients: { ...entry.nutrients },
      source: entry.source,
      barcodeUpc: entry.barcodeUpc,
      useCount: entry.useCount,
      favorite: entry.favorite === true,
      icon: entry.icon ?? null,
      lastUsed: entry.lastUsed,
      createdAt: entry.createdAt,
    };
  }

  async #loadCatalog(userId) {
    const raw = this.#dataService.user.read?.(YamlFoodCatalogDatastore.CATALOG_PATH, userId);
    if (!Array.isArray(raw)) return [];
    return raw.map(item => this.#hydrate(item));
  }

  async #saveCatalog(entries, userId) {
    const data = entries.map(e => this.#dehydrate(e));
    return this.#dataService.user.write?.(YamlFoodCatalogDatastore.CATALOG_PATH, data, userId);
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
    const catalog = await this.#loadCatalog(userId);
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
    const catalog = await this.#loadCatalog(userId);
    const idx = catalog.findIndex(e => e.id === id);
    if (idx < 0) return false;
    catalog.splice(idx, 1);
    const result = await this.#saveCatalog(catalog, userId);
    if (result === false) {
      const err = new Error(`CATALOG_WRITE_FAILED: could not write food catalog to ${YamlFoodCatalogDatastore.CATALOG_PATH} for user ${userId}`);
      err.code = 'CATALOG_WRITE_FAILED';
      throw err;
    }
    return true;
  }
}
