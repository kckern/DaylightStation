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

  /**
   * @param {Object} config
   * @param {Object} config.catalogStore - IFoodCatalogDatastore
   * @param {Object} [config.nutriListStore] - NutriList store for quick-add and backfill
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.catalogStore) throw new Error('FoodCatalogService requires catalogStore');
    this.#catalogStore = config.catalogStore;
    this.#nutriListStore = config.nutriListStore || null;
    this.#logger = config.logger || console;
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
      existing.recordUsage();
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
        name: foodItem.name,
        nutrients: {
          calories: foodItem.calories || 0,
          protein: foodItem.protein || 0,
          carbs: foodItem.carbs || 0,
          fat: foodItem.fat || 0,
        },
        source: foodItem.source || 'nutritionix',
        barcodeUpc: foodItem.barcodeUpc || null,
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

    const today = new Date().toISOString().split('T')[0];
    const { randomUUID } = await import('crypto');
    const item = {
      uuid: randomUUID(),
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
    entry.recordUsage();
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
    const now = new Date();

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
}
