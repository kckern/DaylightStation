/**
 * FoodCatalogEntry - Represents a food item in the user's personal catalog.
 *
 * Built passively from logged foods. Tracks usage frequency for quick-add.
 */

export class FoodCatalogEntry {
  constructor(data) {
    if (!data.id || !data.lastUsed || !data.createdAt) throw new Error('FoodCatalogEntry requires id, lastUsed, and createdAt');
    this.id = data.id;
    this.name = data.name;
    this.normalizedName = data.normalizedName || FoodCatalogEntry.normalize(data.name);
    this.nutrients = data.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    this.source = data.source || 'manual';
    this.barcodeUpc = data.barcodeUpc || null;
    this.useCount = data.useCount || 1;
    this.favorite = data.favorite === true;
    // The manifest slug this food is pictured with (PRD F5.2). Null means "no
    // picture chosen" and renders the neutral fallback glyph — never a guessed
    // filename, because filenames live in the manifest and nowhere else.
    // It sticks to the FOOD, not to one entry (U5.2), which is why it lives
    // here and gets copied onto each quick-added row.
    this.icon = data.icon || null;
    this.lastUsed = data.lastUsed;
    this.createdAt = data.createdAt;
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
  recordUsage(lastUsed) {
    if (typeof lastUsed !== 'string' || !lastUsed) throw new Error('FoodCatalogEntry.recordUsage requires lastUsed');
    this.useCount++;
    this.lastUsed = lastUsed;
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
