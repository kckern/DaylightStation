/**
 * FoodCatalogService - Application service for food catalog operations.
 *
 * Handles recording, search, quick-add, and backfill.
 */

import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { hasMicroData, pickMicros } from '#domains/nutrition/services/micros.mjs';
import { rankSuggestions } from '#domains/health/services/bucketSuggestRanking.mjs';
import { observationFromRow, DRIFT_RATIO, ratioApart } from '#domains/health/services/catalogDensity.mjs';
import { formatLocalTimestamp } from '#system/utils/time.mjs';
import { defaultBucketForDate } from '#shared/contracts/health/isoDate.mjs';
import { foodGrams, NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { bucketForHour } from '#shared/contracts/health/mealBuckets.mjs';
import { v5 as uuidv5 } from 'uuid';

/** Local (not UTC) YYYY-MM-DD from a Date instance. */
function localDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * `'default'` is the capture pipeline's sentinel for "the model named no icon"
 * (LogFoodFromText/Image map an absent or unknown slug to it). It resolves to a
 * real file so a row never shows a broken image, but it is NOT a choice about
 * this food: donating it to the catalog would pin the food to the fallback
 * glyph permanently, and every later real icon would be refused as "already
 * has one".
 */
const NEUTRAL_ICON = 'default';
const isRealIcon = (icon) => typeof icon === 'string' && icon !== '' && icon !== NEUTRAL_ICON;

/** The four meal buckets. A value outside this set is not recorded as one. */
const MEAL_BUCKETS = ['morning', 'afternoon', 'evening', 'night'];
const asBucket = (value) => (MEAL_BUCKETS.includes(value) ? value : null);

/** The clock's opinion when nothing more authoritative is supplied. */

/**
 * A portion worth remembering, or null. All-empty quantities are dropped so a
 * recorded `{}` cannot displace a real portion the entry already knew.
 */
function normalizeQuantity(quantity) {
  if (!quantity) return null;
  const grams = Number.isFinite(Number(quantity.grams)) ? Number(quantity.grams) : null;
  const amount = Number.isFinite(Number(quantity.amount)) ? Number(quantity.amount) : null;
  const unit = typeof quantity.unit === 'string' && quantity.unit ? quantity.unit : null;
  if (grams === null && amount === null && unit === null) return null;
  return { grams, unit, amount };
}

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
   * @param {Object} foodItem - { name, calories, protein, carbs, fat, source?, barcodeUpc?,
   *   fiber?, sugar?, sodium?, cholesterol?, microsSource?, icon?, mealTime?, grams?, unit?, amount? }
   * @param {string} userId
   */
  async recordUsage(foodItem, userId) {
    if (!foodItem?.name) return;

    const normalized = FoodCatalogEntry.normalize(foodItem.name);
    const existing = (foodItem.foodId && await this.#catalogStore.getById(foodItem.foodId, userId))
      || await this.#catalogStore.findByNormalizedName(foodItem.name, userId);
    const today = new Date(this.#clock.now()).toISOString().slice(0, 10);
    // Bucket history advances only when the CALLER knows the bucket. Nothing
    // here derives one from the clock: a caller that cannot say which meal this
    // was would otherwise donate a guess, and a wrong bucket is unrecoverable
    // once it is a count on disk.
    const bucket = asBucket(foodItem.mealTime);
    const bucketOptions = bucket
      ? { bucket, quantity: normalizeQuantity(foodItem) ?? undefined }
      : {};

    if (existing) {
      existing.recordUsage(today, bucketOptions);
      // NOT "latest wins". The catalog's canonical nutrition is DERIVED from
      // the observation ring (FoodCatalogEntry.nutrients), so a capture
      // CONTRIBUTES evidence rather than overwriting the answer. Overwriting is
      // what made a two-bottle log the permanent definition of one bottle.
      // A row with no usable mass contributes nothing: it carries a total with
      // nothing to divide by, and adding it would put a portion multiple back
      // into the thing that is supposed to be portion-independent.
      const observation = observationFromRow({ ...foodItem, date: today }, { source: foodItem.source || null });
      if (observation) existing.addObservation(observation);
      // Micros are copied PER KEY, and only off a row that carries
      // provenance. Two gates, because either one alone leaks:
      //   - no `microsSource` at all -> the row's micros are structural
      //     zeros, and donating them manufactures "catalog micro data";
      //   - provenance but an ABSENT key -> the model answered about some
      //     micros and not others, and only the keys it answered may be
      //     donated. Callers must therefore pass the model's own micros,
      //     not `?? 0`-defaulted ones (see the capture use cases).
      // A donation never clears a key it does not carry: an entry can
      // accumulate micros across captures, and nothing here writes a 0 it
      // was not given.
      if (foodItem.microsSource) existing.donateMicros(pickMicros(foodItem), foodGrams(foodItem), foodItem.microsSource);
      // Provenance FILLS, like the icon. A barcode scan is the strongest thing
      // that ever names this food, so it may claim an entry that has no UPC —
      // but it never renames one that already carries a different code.
      if (!existing.barcodeUpc && foodItem.barcodeUpc) {
        existing.barcodeUpc = foodItem.barcodeUpc;
        existing.source = foodItem.source || existing.source;
      }
      // Icons FILL, they never overwrite. `setIcon` (the edit sheet's "always
      // for this food") is a deliberate human choice, and a later parse of the
      // same food must not quietly undo it — an override that survives until
      // the next log of that food is not an override. The neutral sentinel is
      // not an icon: donating it would pin the food to the fallback glyph and
      // block every real icon that came after.
      if (!existing.icon && isRealIcon(foodItem.icon)) existing.icon = foodItem.icon;
      await this.#catalogStore.save(existing, userId);
      this.#logger.debug?.('health.catalog.usage_recorded', { name: foodItem.name, useCount: existing.useCount });
    } else {
      const entry = new FoodCatalogEntry({
        id: foodItem.foodId || this.#createId(),
        name: foodItem.name,
        nutrients: {
          calories: foodItem.calories || 0,
          protein: foodItem.protein || 0,
          carbs: foodItem.carbs || 0,
          fat: foodItem.fat || 0,
          // Same rule as the update path above: no provenance, no micros. The
          // absence of these keys is what "we don't know" looks like in the
          // catalog — a stored 0 would be a claim.
          ...(foodItem.microsSource ? pickMicros(foodItem) : {}),
        },
        source: foodItem.source || 'nutritionix',
        barcodeUpc: foodItem.barcodeUpc || null,
        icon: isRealIcon(foodItem.icon) ? foodItem.icon : null,
        // A brand-new entry starts its bucket history at this first use, so the
        // very first thing a food records is already bucket-aware.
        usageByBucket: bucket
          ? { [bucket]: { count: 1, lastUsed: today, quantity: normalizeQuantity(foodItem) } }
          : {},
        lastUsed: today,
        createdAt: new Date(this.#clock.now()).toISOString(),
      });
      // The first capture is also the first observation, when it carries a mass.
      const firstObservation = observationFromRow({ ...foodItem, date: today }, { source: foodItem.source || null });
      if (firstObservation) entry.addObservation(firstObservation);
      if (foodItem.microsSource) entry.donateMicros(pickMicros(foodItem), foodGrams(foodItem), foodItem.microsSource);
      await this.#catalogStore.save(entry, userId);
      this.#logger.debug?.('health.catalog.entry_created', { name: foodItem.name, id: entry.id });
    }
  }

  /**
   * Quick-add a catalog entry into the day the client is looking at.
   * @param {string} catalogEntryId
   * @param {string} userId
   * @param {Object} [options]
   * @param {string} [options.mealTime] - the bucket the add-row was launched
   *   from. Supplied directly by the client (Task 9.2), which retires the
   *   follow-up PUT that used to move the row after the fact. Falls back to the
   *   clock when absent — Telegram and the coach never send one.
   * @param {string} [options.date] - the day the client is LOOKING AT
   *   (`YYYY-MM-DD`). ABSENT MEANS TODAY. The row's logical `date` follows it;
   *   `settledAt` does not — that is a real wall-clock instant and stays one.
   * @returns {Promise<Object>} The logged item
   */
  async quickAdd(catalogEntryId, userId, options = {}) {
    const entry = await this.#catalogStore.getById(catalogEntryId, userId);
    if (!entry) throw new Error(`Catalog entry not found: ${catalogEntryId}`);

    if (!this.#nutriListStore) throw new Error('NutriListStore not configured for quick-add');

    const now = new Date(this.#clock.now());
    // LOCAL date, not UTC — new Date().toISOString() reads as tomorrow every
    // evening after ~5pm in this household's timezone (UTC-7/8), which
    // silently misfiles the quick-add onto the wrong day.
    // The day this lands on is the day the CLIENT is looking at. `today` is
    // only the fallback — the shipped bug was a quick-add made while viewing
    // yesterday landing on the server's today.
    const today = localDateISO(now);
    const targetDate = options?.date || today;
    // A catalog entry only holds micros if a provenanced row donated them
    // (recordUsage). When it does, the quick-added row inherits BOTH the
    // numbers and the provenance; when it does not, the row is written with no
    // micros and `microsSource: null` — honestly uncovered, rather than
    // carrying structural zeros under a 'catalog' claim.
    // Decision 2.24: a day that is not today has no "current hour", so the
    // clock cannot speak for it — such a day is filled from its first meal.
    const mealTime = asBucket(options?.mealTime) || defaultBucketForDate(targetDate, now, bucketForHour);
    // PRD F8.3: the portion defaults to the last one logged for this food IN
    // THIS BUCKET. Absent (a food never eaten at this meal), the catalog default
    // stands — one serving, which is the portion the entry's own numbers
    // describe. Per field, so a remembered `grams` is not lost to a missing `unit`.
    const { grams, nutrients } = entry.proposedPortion(mealTime);
    const unit = 'g';
    const amount = grams;
    // The row's numbers are DENSITY x THIS PORTION, not a copy of a stored
    // total. That is what makes the fix self-correcting: a food whose ring
    // still holds a doubled row derives its serving from the median density,
    // and a remembered 385 g portion of a 0.485 kcal/g shake yields 187 kcal
    // rather than the 610 the old copy-the-total path produced.
    //
    // Null when the entry cannot be scaled (no observation carries a mass, or
    // no portion is remembered): the canonical view then stands exactly as it
    // did, because an unscalable food must keep working rather than become a
    // written zero.
    const micros = pickMicros(nutrients);
    const item = {
      uuid: this.#createId(),
      userId,
      item: entry.name,
      name: entry.name,
      foodId: entry.id,
      calories: nutrients.calories,
      protein: nutrients.protein,
      carbs: nutrients.carbs,
      fat: nutrients.fat,
      ...micros,
      microsSource: hasMicroData(micros) ? 'catalog' : null,
      nutrientProvenance: Object.fromEntries(Object.keys(micros).map(key => [key, { source: 'catalog', grams }])),
      grams,
      unit,
      amount,
      color: 'yellow',
      // The food's picture travels with it (PRD U5.2). Null when the catalog
      // entry has none — the row then renders the neutral dot, rather than a
      // filename this layer invented.
      icon: entry.icon ?? null,
      date: targetDate,
      mealTime,
      // A one-tap pick of a known food is a DELIBERATE choice, not a machine
      // estimate, so the row lands settled (PRD F8.3). Written verbatim,
      // never `?? true`: an ABSENT `settled` means "legacy row, treat as
      // settled" (decision 2.6), so a defaulted value anywhere on this path
      // would change what every pre-existing row means.
      settled: true,
      settledBy: 'user',
      settledAt: formatLocalTimestamp(now),
      log_uuid: 'QUICKADD',
    };

    await this.#nutriListStore.saveMany([item]);
    // The bucket this actually landed in, and the portion it landed with —
    // so the next pick of this food at this meal defaults to the same portion.
    entry.recordUsage(targetDate, { bucket: mealTime, quantity: normalizeQuantity({ grams, unit, amount }) ?? undefined });
    await this.#catalogStore.save(entry, userId);

    this.#logger.info?.('health.catalog.quickadd', { name: entry.name, id: entry.id, date: targetDate, mealTime });
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

  async getById(id, userId) {
    return this.#catalogStore.getById(id, userId);
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
        // `label` is only ONE of the shapes on disk. `syncFromLog` rows key the
        // name as `label`; `saveMany` rows (quick-adds, group children) key it
        // as `item` — and on the production nutrilist the `item`-shaped rows
        // are the MAJORITY, so gating on `label` alone silently skipped most of
        // the history this backfill claims to read. `#normalizeItem` already
        // resolves all three into `name`; the fallbacks keep this honest for a
        // store that hands back raw rows. 'Unknown' is the store's sentinel for
        // a row with no name at all, and is not a food.
        const label = item?.name || item?.item || item?.label;
        if (!label || label === 'Unknown') continue;
        const existing = await this.#catalogStore.findByNormalizedName(label, userId);
        if (existing) {
          updated++;
        } else {
          created++;
        }
        await this.recordUsage({
          name: label,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          // Icons DO backfill, unlike micros below. A stored `icon` is a slug
          // chosen for that food, not a number defaulted at the persistence
          // boundary, so nothing about it has been lost by the time a backfill
          // reads it — and recordUsage only fills an ABSENT icon, so a
          // backfill can never overwrite a human choice.
          icon: item.icon,
          // The bucket and portion DO backfill, for the same reason icons do:
          // a stored row's `mealTime` is the RESOLVED meal (an explicit "for
          // lunch", or the row the capture was launched from, having already
          // beaten the clock upstream), so it is the one trustworthy source of
          // bucket history in the system. This is what seeds the bucket-aware
          // suggest list from real history rather than only from quick-adds.
          mealTime: item.mealTime,
          grams: item.grams,
          unit: item.unit,
          amount: item.amount,
          // NO micros, deliberately. A stored row's fiber/sugar/sodium/
          // cholesterol have already been defaulted to 0 at the persistence
          // boundary, so per-key provenance is gone by the time a backfill can
          // read them — `microsSource: 'ai'` only says the model answered about
          // SOME micro, never which. Donating those numbers would write hard
          // zeros into the catalog that every later quick-add inherits as a
          // 'catalog' reading, permanently. Micros enter the catalog from a
          // live capture, where the model's own answer is still intact.
        }, userId);
        processed++;
      }
    }

    this.#logger.info?.('health.catalog.backfill', { userId, daysBack, processed, created, updated });
    return { processed, created, updated };
  }

  /**
   * One ranked suggestion list for the add-combobox.
   *
   * Without a bucket this is exactly what it always was: favorites first, then
   * recency-weighted frequency, then name. With a bucket (PRD F8.1) the middle
   * tier becomes the per-bucket blend and the global ranking backfills only
   * while the bucket's history is thin — see `bucketSuggestRanking.mjs`, which
   * owns the maths and takes the clock as an argument.
   *
   * @param {string} query - '' for the zero-keystroke list
   * @param {string} userId
   * @param {number} [limit=12]
   * @param {Object} [options]
   * @param {string} [options.bucket] - meal bucket the add row was launched from
   */
  async suggest(query, userId, limit = 12, options = {}) {
    const all = await this.#catalogStore.getAll(userId);
    const q = (query || '').toLowerCase().trim();
    const candidates = all.filter((e) => (q ? e.matchesSearch(q) : true));
    return rankSuggestions(candidates, {
      bucket: asBucket(options?.bucket),
      nowMs: this.#clock.now(),
      limit,
    }).map(entry => ({ ...entry, ...entry.proposedPortion(options.bucket), canonicalGrams: entry.canonicalGrams }));
  }

  /** Explicit future-food definition; historical entries and observation evidence stay untouched. */
  async updateDefinition(id, userId, { name, grams, nutrients }) {
    const existing = await this.#catalogStore.getById(id, userId);
    if (!existing) throw Object.assign(new Error('Food not found'), { status: 404 });
    if (typeof name !== 'string' || !name.trim() || typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) throw Object.assign(new Error('Name and positive gram weight required'), { status: 400 });
    const known = Object.fromEntries(NUTRIENT_KEYS.filter(key => nutrients?.[key] != null).map(key => [key, nutrients[key]]));
    if (!Number.isFinite(known.calories) || Object.values(known).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw Object.assign(new Error('Nutrition must contain non-negative numbers'), { status: 400 });
    const duplicate = await this.#catalogStore.findByNormalizedName(name, userId);
    if (duplicate && duplicate.id !== id) throw Object.assign(new Error('Another food already has that name; choose a distinct name'), { status: 409 });
    const entry = new FoodCatalogEntry({ ...existing, name: name.trim(), normalizedName: FoodCatalogEntry.normalize(name), nutrients: existing.baseNutrients,
      manualPortion: { grams, nutrients: known, source: 'user', at: new Date(this.#clock.now()).toISOString() } });
    await this.#catalogStore.save(entry, userId);
    this.#logger.info?.('health.catalog.definition_updated', { id });
    return entry;
  }

  async resolveIdentity(item, userId) {
    if (item.kind === 'group') return item;
    const foodId = item.foodId || uuidv5(`${userId}:food:${FoodCatalogEntry.normalize(item.name || item.label)}`, uuidv5.URL);
    try {
      const entry = item.foodId ? await this.#catalogStore.getById(item.foodId, userId)
        : await this.#catalogStore.findByNormalizedName(item.name || item.label, userId);
      return entry ? { ...item, foodId: entry.id, icon: entry.icon || item.icon } : { ...item, foodId };
    } catch (err) {
      this.#logger.warn?.('health.catalog.identity_unavailable', { error: err.message });
      return { ...item, foodId };
    }
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

  /**
   * Pin this food's icon (the edit sheet's "always for this food", PRD F5.4).
   * Unlike recordUsage's fill, this OVERWRITES: it is an explicit human
   * correction, and past rows follow on their next render because the row's
   * own icon is only a copy taken at log time.
   * @param {string} id
   * @param {string} userId
   * @param {string|null} icon - a manifest slug, or null to clear back to the
   *   neutral fallback
   */
  async setIcon(id, userId, icon) {
    const entry = await this.#catalogStore.getById(id, userId);
    if (!entry) throw new Error(`Catalog entry not found: ${id}`);
    entry.icon = isRealIcon(icon) ? icon : null;
    await this.#catalogStore.save(entry, userId);
    this.#logger.info?.('health.catalog.icon_set', { id, icon: entry.icon });
    return entry;
  }

  /** Same, addressed by food name — what a log row can actually supply. */
  async setIconByName(name, userId, icon) {
    const existing = await this.#catalogStore.findByNormalizedName(name, userId);
    if (!existing) throw new Error(`Catalog entry not found by name: ${name}`);
    return this.setIcon(existing.id, userId, icon);
  }

  async getByUpc(upc, userId) {
    return this.#catalogStore.findByUpc(upc, userId);
  }

  /**
   * The catalog's own opinion about how dense this food is (kcal per gram),
   * or null when it has never seen this food logged with a usable mass.
   *
   * Null is a real answer and callers must treat it as one: "I have no
   * history for this" is not "this looks fine".
   *
   * @param {string} name
   * @param {string} userId
   * @returns {Promise<{density: number, sampleCount: number, canonicalGrams: number|null}|null>}
   */
  async densityForName(name, userId) {
    if (!name) return null;
    const entry = await this.#catalogStore.findByNormalizedName(name, userId);
    if (!entry) return null;
    const density = entry.densityKcalPerGram;
    if (density === null) return null;
    return { density, sampleCount: entry.observationSampleCount, canonicalGrams: entry.canonicalGrams };
  }

  /**
   * Judge freshly parsed capture items against each food's own history.
   *
   * Returns one finding per item that sits more than DRIFT_RATIO away from the
   * catalog's median density for that name. It CHANGES NOTHING — the numbers
   * the model produced are the numbers that get logged, and the person decides
   * on the confirmation message. Auto-correcting here would replace a visible
   * wrong number with an invisible one.
   *
   * An item with no usable mass, or a food with no history, produces no
   * finding: there is nothing to compare, and a guard that fires on absence is
   * a guard nobody reads.
   *
   * @param {Array<Object>} items - parsed items ({label, calories, grams, unit, amount})
   * @param {string} userId
   * @param {number} [threshold=DRIFT_RATIO]
   * @returns {Promise<Array<{name, calories, grams, ratio, expectedCalories, density, sampleCount}>>}
   */
  async assessDensity(items, userId, threshold = DRIFT_RATIO) {
    const findings = [];
    for (const item of Array.isArray(items) ? items : []) {
      const name = item?.label || item?.name;
      const observation = observationFromRow({ ...item, calories: item?.calories });
      if (!name || !observation) continue;
      let known;
      try {
        known = await this.densityForName(name, userId);
      } catch (err) {
        this.#logger.warn?.('health.catalog.density_lookup_failed', { name, error: err.message });
        continue;
      }
      if (!known) continue;
      const rowDensity = observation.kcal / observation.grams;
      const ratio = ratioApart(rowDensity, known.density);
      if (ratio === null || ratio < threshold) continue;
      findings.push({
        name,
        calories: observation.kcal,
        grams: observation.grams,
        ratio,
        expectedCalories: Math.round(known.density * observation.grams),
        density: known.density,
        sampleCount: known.sampleCount,
      });
    }
    if (findings.length > 0) {
      this.#logger.info?.('health.catalog.density_flagged', {
        userId,
        count: findings.length,
        names: findings.map((f) => f.name),
      });
    }
    return findings;
  }

  /**
   * Permanently remove a catalog entry (e.g. test-created junk, a bad
   * custom-food typo). Not a soft delete — there's no "undo" for the food
   * catalog the way there is for a NutriLog.
   * @param {string} id
   * @param {string} userId
   * @throws {Error} code NOT_FOUND when the id doesn't exist
   */
  async remove(id, userId) {
    const removed = await this.#catalogStore.removeById(id, userId);
    if (!removed) {
      const err = new Error(`Catalog entry not found: ${id}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    this.#logger.info?.('health.catalog.removed', { id, userId });
  }

  /** Create a user-authored food, optionally mapped to a barcode. */
  async createCustom({ name, calories, protein, carbs, fat, grams, barcodeUpc = null, operationId }, userId) {
    if (!name) throw new Error('createCustom requires name');
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) throw Object.assign(new Error('A positive gram weight is required'), { status: 400 });
    const entry = new FoodCatalogEntry({
      id: operationId ? uuidv5(`${userId}:custom:${operationId}`, uuidv5.URL) : this.#createId(),
      name,
      baseGrams: grams,
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
