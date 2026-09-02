/**
 * FoodCatalogService - Application service for food catalog operations.
 *
 * Handles recording, search, quick-add, and backfill.
 */

import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

export class FoodCatalogService {
  #catalogStore;
  #nutriListStore;
  #logger;
  #clock;
  #createId;

  /**
   * @param {Object} config
   * @param {Object} config.catalogStore - IFoodCatalogDatastore
   * @param {Object} [config.nutriListStore] - NutriList store for quick-add and backfill
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.catalogStore) throw new Error('FoodCatalogService requires catalogStore');
    if (!config.clock?.now || typeof config.createId !== 'function') throw new Error('FoodCatalogService requires clock and createId');
    this.#catalogStore = config.catalogStore;
    this.#nutriListStore = config.nutriListStore || null;
    this.#logger = config.logger || console;
    this.#clock = config.clock;
    this.#createId = config.createId;
  }

  /**
   * Record usage of a food item in the catalog.
   * Called after every successful food log.
   * Finds or creates a catalog entry, increments useCount.
   *
   * @param {Object} foodItem - { name, calories, protein, carbs, fat, source?, barcodeUpc? }
   * @param {string} userId
   */
  async recordUsage(foodItem, userId) {
    if (!foodItem?.name) return;

    const normalized = FoodCatalogEntry.normalize(foodItem.name);
    const existing = await this.#catalogStore.findByNormalizedName(foodItem.name, userId);

    if (existing) {
      existing.recordUsage(new Date(this.#clock.now()).toISOString().slice(0, 10));
      // Update nutrients if the new data has them (latest wins)
      if (foodItem.calories != null) {
        existing.nutrients = {
          calories: foodItem.calories || existing.nutrients.calories,
          protein: foodItem.protein || existing.nutrients.protein,
          carbs: foodItem.carbs || existing.nutrients.carbs,
          fat: foodItem.fat || existing.nutrients.fat,
        };
      }
      await this.#catalogStore.save(existing, userId);
      this.#logger.debug?.('health.catalog.usage_recorded', { name: foodItem.name, useCount: existing.useCount });
    } else {
      const entry = new FoodCatalogEntry({
        id: this.#createId(),
        name: foodItem.name,
        nutrients: {
          calories: foodItem.calories || 0,
          protein: foodItem.protein || 0,
          carbs: foodItem.carbs || 0,
          fat: foodItem.fat || 0,
        },
        source: foodItem.source || 'nutritionix',
        barcodeUpc: foodItem.barcodeUpc || null,
        lastUsed: new Date(this.#clock.now()).toISOString().slice(0, 10),
        createdAt: new Date(this.#clock.now()).toISOString(),
      });
      await this.#catalogStore.save(entry, userId);
      this.#logger.debug?.('health.catalog.entry_created', { name: foodItem.name, id: entry.id });
    }
  }

  /**
   * Quick-add a catalog entry as today's food log.
   * @param {string} catalogEntryId
   * @param {string} userId
   * @returns {Promise<Object>} The logged item
   */
  async quickAdd(catalogEntryId, userId) {
    const entry = await this.#catalogStore.getById(catalogEntryId, userId);
    if (!entry) throw new Error(`Catalog entry not found: ${catalogEntryId}`);

    if (!this.#nutriListStore) throw new Error('NutriListStore not configured for quick-add');

    const today = new Date(this.#clock.now()).toISOString().split('T')[0];
    const item = {
      uuid: this.#createId(),
      userId,
      item: entry.name,
      name: entry.name,
      calories: entry.nutrients.calories,
      protein: entry.nutrients.protein,
      carbs: entry.nutrients.carbs,
      fat: entry.nutrients.fat,
      grams: 0,
      unit: 'serving',
      amount: 1,
      color: 'yellow',
      date: today,
      log_uuid: 'QUICKADD',
    };

    await this.#nutriListStore.saveMany([item]);
    entry.recordUsage(today);
    await this.#catalogStore.save(entry, userId);

    this.#logger.info?.('health.catalog.quickadd', { name: entry.name, id: entry.id });
    return item;
  }

  /**
   * Search the catalog by name substring.
   * @param {string} query
   * @param {string} userId
   * @param {number} [limit=10]
   */
  async search(query, userId, limit = 10) {
    return this.#catalogStore.search(query, userId, limit);
  }

  /**
   * Get recently used catalog entries.
   * @param {string} userId
   * @param {number} [limit=10]
   */
  async getRecent(userId, limit = 10) {
    return this.#catalogStore.getRecent(userId, limit);
  }

  /**
   * Backfill catalog from existing nutriday data.
   * Reads nutrilist entries and records each as catalog usage.
   *
   * @param {string} userId
   * @param {number} [daysBack=90]
   * @returns {Promise<{ processed: number, created: number, updated: number }>}
   */
  async backfill(userId, daysBack = 90) {
    if (!this.#nutriListStore) throw new Error('NutriListStore not configured for backfill');

    let processed = 0, created = 0, updated = 0;
    const now = new Date(this.#clock.now());

    for (let i = 0; i < daysBack; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];

      let items;
      try {
        items = await this.#nutriListStore.findByDate(userId, date);
      } catch {
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) continue;

      for (const item of items) {
        if (!item?.label) continue;
        const existing = await this.#catalogStore.findByNormalizedName(item.label, userId);
        if (existing) {
          updated++;
        } else {
          created++;
        }
        await this.recordUsage({
          name: item.label,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        }, userId);
        processed++;
      }
    }

    this.#logger.info?.('health.catalog.backfill', { userId, daysBack, processed, created, updated });
    return { processed, created, updated };
  }

  /**
   * One ranked suggestion list for the add-combobox: favorites first, then
   * recency-weighted frequency, then name matches. Empty query = favorites
   * plus recent/frequent entries.
   */
  async suggest(query, userId, limit = 12) {
    const all = await this.#catalogStore.getAll(userId);
    const q = (query || '').toLowerCase().trim();
    const nowDay = new Date(this.#clock.now());
    const score = (e) => {
      const daysSince = Math.max(0, (nowDay - new Date(`${e.lastUsed}T12:00:00Z`)) / 86400000);
      return e.useCount / (1 + daysSince / 30);
    };
    return all
      .filter((e) => (q ? e.matchesSearch(q) : true))
      .sort((a, b) =>
        (b.favorite === true) - (a.favorite === true)
        || score(b) - score(a)
        || a.normalizedName.localeCompare(b.normalizedName))
      .slice(0, limit);
  }

  async setFavorite(id, userId, favorite) {
    const entry = await this.#catalogStore.getById(id, userId);
    if (!entry) throw new Error(`Catalog entry not found: ${id}`);
    entry.favorite = favorite === true;
    await this.#catalogStore.save(entry, userId);
    this.#logger.info?.('health.catalog.favorite', { id, favorite: entry.favorite });
    return entry;
  }

  async setFavoriteByName(name, userId, favorite) {
    const existing = await this.#catalogStore.findByNormalizedName(name, userId);
    if (!existing) throw new Error(`Catalog entry not found by name: ${name}`);
    return this.setFavorite(existing.id, userId, favorite);
  }

  async getByUpc(upc, userId) {
    return this.#catalogStore.findByUpc(upc, userId);
  }

  /** Create a user-authored food, optionally mapped to a barcode. */
  async createCustom({ name, calories, protein, carbs, fat, barcodeUpc = null }, userId) {
    if (!name) throw new Error('createCustom requires name');
    const entry = new FoodCatalogEntry({
      id: this.#createId(),
      name,
      nutrients: {
        calories: Number(calories) || 0,
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
      },
      source: 'custom',
      barcodeUpc,
      lastUsed: new Date(this.#clock.now()).toISOString().slice(0, 10),
      createdAt: new Date(this.#clock.now()).toISOString(),
    });
    await this.#catalogStore.save(entry, userId);
    this.#logger.info?.('health.catalog.custom_created', { name, barcodeUpc });
    return entry;
  }
}
