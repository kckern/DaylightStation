/**
 * FoodCatalogEntry - Represents a food item in the user's personal catalog.
 *
 * Built passively from logged foods. Tracks usage frequency for quick-add.
 */

import { deriveCanonical, sortObservations, normalizeRing, OBSERVATION_LIMIT } from '#domains/health/services/catalogDensity.mjs';

export class FoodCatalogEntry {
  /**
   * What the entry holds on disk under `nutrients`. It is NOT the canonical
   * value any more — it is the fallback the derived view falls through to when
   * the observation ring cannot answer (a food never logged with a mass, an
   * entry created by hand). See the `nutrients` accessor below.
   */
  #baseNutrients;

  constructor(data) {
    if (!data.id || !data.lastUsed || !data.createdAt) throw new Error('FoodCatalogEntry requires id, lastUsed, and createdAt');
    this.id = data.id;
    this.name = data.name;
    this.normalizedName = data.normalizedName || FoodCatalogEntry.normalize(data.name);
    this.#baseNutrients = data.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    // The last ~20 things actually logged under this name: `{date, kcal,
    // protein, carbs, fat, grams, logId, source}`. This is the entry's
    // evidence, and the canonical nutrition is a function of it.
    this.observations = FoodCatalogEntry.#cloneObservations(data.observations);
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

  /**
   * The canonical nutrition for ONE serving of this food.
   *
   * DERIVED, not stored: the observation nearest the ring's median density,
   * scaled to its median mass (`catalogDensity.deriveCanonical`). The shape is
   * exactly what it always was — `{calories, protein, carbs, fat, ...micros}`
   * — so every existing reader (presenter, suggest, quick-add) is unchanged.
   *
   * Micros are NOT derived. They arrive per key from provenanced captures and
   * live on the base record; the derived macros are layered over them, so a
   * donation is never lost and a missing observation macro falls through to
   * whatever the entry already knew rather than becoming a written 0.
   */
  get nutrients() {
    const derived = deriveCanonical(this.observations);
    if (!derived) return this.#baseNutrients;
    return { ...this.#baseNutrients, ...derived.nutrients };
  }

  /**
   * Replace the fallback record. Kept so the historical
   * `entry.nutrients = {...}` assignment still means something, but the
   * capture path should prefer `donateMicros` — writing macros here does not
   * override the derivation and never did what "latest wins" claimed.
   */
  set nutrients(value) {
    this.#baseNutrients = value || { calories: 0, protein: 0, carbs: 0, fat: 0 };
  }

  /** What is actually on disk, before derivation. For the dehydrator. */
  get baseNutrients() { return this.#baseNutrients; }

  /** The portion (in grams) the canonical numbers describe, or null. */
  get canonicalGrams() {
    return deriveCanonical(this.observations)?.grams ?? null;
  }

  /** The entry's own median kcal/g, or null when nothing observed carries a mass. */
  get densityKcalPerGram() {
    return deriveCanonical(this.observations)?.density ?? null;
  }

  /** How many observations actually contribute to the derivation. */
  get observationSampleCount() {
    return deriveCanonical(this.observations)?.sampleCount ?? 0;
  }

  /**
   * The nutrition of `grams` of this food, scaled off the canonical serving.
   *
   * Null when the entry cannot say — the caller then keeps whatever it would
   * have used, because an unscalable food must not silently become zero.
   */
  nutrientsForGrams(grams) {
    const mass = Number(grams);
    if (!Number.isFinite(mass) || mass <= 0) return null;
    const derived = deriveCanonical(this.observations);
    if (!derived || !(derived.grams > 0)) return null;
    const factor = mass / derived.grams;
    const out = { ...this.#baseNutrients, ...derived.nutrients };
    out.calories = Math.round(derived.nutrients.calories * factor);
    for (const key of ['protein', 'carbs', 'fat']) {
      if (typeof derived.nutrients[key] === 'number') {
        out[key] = Math.round(derived.nutrients[key] * factor * 10) / 10;
      }
    }
    return out;
  }

  /**
   * Merge micronutrients into the base record, per key, without touching
   * macros. This is what a provenanced capture donates — the two-gate rule
   * lives in FoodCatalogService; this only writes what it is handed.
   */
  donateMicros(micros) {
    if (!micros || typeof micros !== 'object') return;
    this.#baseNutrients = { ...this.#baseNutrients, ...micros };
  }

  /**
   * Add one observation to the ring, or replace the one with the same
   * `logId`.
   *
   * Replacing rather than appending is what makes a re-run harmless: the row
   * id is the identity, so recording the same logged row twice leaves the ring
   * with one copy of it. The ring is then trimmed OLDEST-FIRST by
   * (date, logId), which is a total order, so the survivors are a function of
   * the input set and not of the order it arrived in.
   */
  addObservation(observation) {
    if (!observation || typeof observation !== 'object') return;
    const kept = observation.logId
      ? this.observations.filter((o) => o.logId !== observation.logId)
      : [...this.observations];
    kept.push({ ...observation });
    this.observations = sortObservations(kept).slice(-OBSERVATION_LIMIT);
  }

  /**
   * Replace the whole ring with a deterministic window over `observations`.
   * The reconcile uses this rather than repeated `addObservation` so that a
   * second run over the same history produces the identical ring — the
   * property `backfill` does not have (decision 2.29).
   */
  setObservations(observations) {
    this.observations = normalizeRing(observations);
  }

  /** Defensive copy: stored observations must not alias the caller's array. */
  static #cloneObservations(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((o) => o && typeof o === 'object').map((o) => ({ ...o }));
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
