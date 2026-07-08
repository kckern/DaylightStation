/**
 * FoodCatalogEntry - Represents a food item in the user's personal catalog.
 *
 * Built passively from logged foods. Tracks usage frequency for quick-add.
 */

import { randomUUID } from 'crypto';

export class FoodCatalogEntry {
  constructor(data) {
    this.id = data.id || randomUUID();
    this.name = data.name;
    this.normalizedName = data.normalizedName || FoodCatalogEntry.normalize(data.name);
    this.nutrients = data.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    this.source = data.source || 'manual';
    this.barcodeUpc = data.barcodeUpc || null;
    this.useCount = data.useCount || 1;
    this.lastUsed = data.lastUsed || new Date().toISOString().split('T')[0];
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  /**
   * Normalize a food name for dedup/search matching.
   * @param {string} name
   * @returns {string}
   */
  static normalize(name) {
    if (!name) return '';
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Record another usage of this entry.
   */
  recordUsage() {
    this.useCount++;
    this.lastUsed = new Date().toISOString().split('T')[0];
  }

  /**
   * Check if this entry matches a normalized name.
   * @param {string} normalizedName
   * @returns {boolean}
   */
  matches(normalizedName) {
    return this.normalizedName === normalizedName;
  }

  /**
   * Check if this entry's name contains the search query.
   * @param {string} query - Lowercase search string
   * @returns {boolean}
   */
  matchesSearch(query) {
    return this.normalizedName.includes(query.toLowerCase().trim());
  }

  // Serialization is owned by the persistence adapter (YamlFoodCatalogDatastore
  // #hydrate/#dehydrate), not the entity — audit D-3, serialization migration
  // phase 2. The entity exposes its fields as public properties for the
  // dehydrator; it deliberately no longer carries toJSON()/fromJSON().
}
