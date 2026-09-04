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
    // Per-meal-bucket usage, keyed by bucket id (morning/afternoon/evening/
    // night): `{ count, lastUsed, quantity }`. This is what makes the
    // add-combobox's zero-query list bucket-aware (PRD F8.1) and what supplies
    // the portion a one-tap quick-add defaults to (F8.3). An entry that has
    // never been recorded against a bucket carries `{}` — never null, so every
    // reader can index it without a guard.
    this.usageByBucket = FoodCatalogEntry.#cloneUsageByBucket(data.usageByBucket);
    this.lastUsed = data.lastUsed;
    this.createdAt = data.createdAt;
  }

  /** Defensive per-bucket copy: stored records must not alias the caller's object. */
  static #cloneUsageByBucket(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [bucket, usage] of Object.entries(raw)) {
      if (!usage || typeof usage !== 'object') continue;
      out[bucket] = { ...usage };
    }
    return out;
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
   *
   * @param {string} lastUsed - YYYY-MM-DD
   * @param {Object} [options]
   * @param {string} [options.bucket] - meal bucket this usage landed in. Omitted
   *   by callers that cannot say which bucket the food was eaten in; the entry's
   *   bucket history is then simply not advanced (never reset, never guessed).
   * @param {{grams?: number, unit?: string, amount?: number}} [options.quantity] -
   *   the portion actually logged, so a later one-tap quick-add in the same
   *   bucket can default to it (PRD F8.3). Absent leaves the last known portion
   *   in place rather than clearing it — the same fill-never-clobber rule the
   *   icon and micro donations follow.
   */
  recordUsage(lastUsed, options = {}) {
    if (typeof lastUsed !== 'string' || !lastUsed) throw new Error('FoodCatalogEntry.recordUsage requires lastUsed');
    this.useCount++;
    this.lastUsed = lastUsed;

    const bucket = options?.bucket;
    if (typeof bucket !== 'string' || !bucket) return;
    const prior = this.usageByBucket[bucket];
    this.usageByBucket[bucket] = {
      count: (prior?.count || 0) + 1,
      lastUsed,
      quantity: options?.quantity ?? prior?.quantity ?? null,
    };
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
