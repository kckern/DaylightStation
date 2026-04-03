/**
 * YamlFoodCatalogDatastore - YAML persistence for food catalog.
 *
 * Storage: data/users/{username}/lifelog/nutrition/food_catalog.yml
 * Format: Array of FoodCatalogEntry objects.
 */

import { IFoodCatalogDatastore } from '#apps/health/ports/IFoodCatalogDatastore.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

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

  async #loadCatalog(userId) {
    const raw = this.#dataService.user.read?.(YamlFoodCatalogDatastore.CATALOG_PATH, userId);
    if (!Array.isArray(raw)) return [];
    return raw.map(item => FoodCatalogEntry.fromJSON(item));
  }

  async #saveCatalog(entries, userId) {
    const data = entries.map(e => e.toJSON());
    this.#dataService.user.write?.(YamlFoodCatalogDatastore.CATALOG_PATH, data, userId);
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
}
