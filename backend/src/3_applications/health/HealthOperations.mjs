import { presentSettlement } from '#domains/nutrition/services/settlement.mjs';
import { nowTs24 } from '#system/utils/time.mjs';
import { foodGrams, scaleFoodPortion, NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { v5 as uuidv5 } from 'uuid';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';

const NUTRITION_UPDATE_FIELDS = new Set([
  'item', 'name', 'unit', 'amount', 'grams', 'noom_color', 'color',
  'calories', 'fat', 'carbs', 'protein', 'fiber', 'sugar', 'sodium', 'cholesterol', 'date',
  // mealTime is how a quick-added / edited row gets stamped into a bucket
  // (Breakfast/Lunch/Dinner/Snacks) — the today-view combobox (F5) and edit
  // sheet (F6) both PUT this field expecting it to persist.
  'mealTime',
  // settled/settledBy/settledAt: a human edit (or an explicit one-tap
  // confirm, `{ settled: true }` alone) ratifies the machine's estimate.
  // Without these in the whitelist, updateNutritionItem's stamp below is
  // silently dropped before it ever reaches the store.
  'settled', 'settledBy', 'settledAt',
  // Task 5.5: a kitchen-scale re-pair recomputes macros from a density level and
  // explicitly nulls `microsSource` (a density estimate is not AI/catalog
  // micronutrient data) — without it here, `ObservationPairingService.recomputeEntry`'s
  // `changes.microsSource = null` is silently dropped and a stale 'ai'/'catalog'
  // provenance can outlive the AI/catalog numbers it described.
  'microsSource',
  // Task 7.4: the edit sheet's "just this entry" icon override PUTs this
  // field. Without it here, updateNutritionItem drops it silently before the
  // store ever sees it and the sheet closes on a change that never happened.
  'icon',
]);

/**
 * Cohesive health data capability used by the HTTP adapter.
 *
 * The API owns validation and response envelopes. This service owns the
 * persistence-backed queries and commands that previously made the router an
 * orchestrator for stores, personal context, and nutrition-input adapters.
 */
export class HealthOperations {
  constructor({
    healthData,
    nutritionItems = null,
    personalContext = null,
    setDailyCoaching = null,
    nutritionInput = null,
    resolveDefaultUsername = () => 'default',
    resolveCoachingUsername = () => null,
    today,
    newId,
  }) {
    this.healthData = healthData;
    this.nutritionItems = nutritionItems;
    this.personalContext = personalContext;
    this.setDailyCoaching = setDailyCoaching;
    this.nutritionInput = nutritionInput;
    this.resolveDefaultUsername = resolveDefaultUsername;
    this.resolveCoachingUsername = resolveCoachingUsername;
    this.today = today;
    this.newId = newId;
  }

  defaultUsername() {
    return this.resolveDefaultUsername() || 'default';
  }

  coachingUsername(requestedUsername) {
    return requestedUsername || this.resolveCoachingUsername() || null;
  }

  readWeight(username) { return this.healthData.loadWeightData(username); }
  readActivity(username) { return this.healthData.loadActivityData(username); }
  readFitness(username) { return this.healthData.loadFitnessData(username); }
  readNutrition(username) { return this.healthData.loadNutritionData(username); }
  readCoaching(username) { return this.healthData.loadCoachingData(username); }

  get coachingSchemaAvailable() {
    return typeof this.personalContext?.loadPlaybook === 'function';
  }

  async readCoachingDimensions(username) {
    const playbook = await this.personalContext.loadPlaybook(username);
    return Array.isArray(playbook?.coaching_dimensions) ? playbook.coaching_dimensions : [];
  }

  get dailyCoachingAvailable() {
    return !!this.setDailyCoaching;
  }

  saveDailyCoaching(username, date, coaching) {
    return this.setDailyCoaching.execute({ userId: username, date, coaching });
  }

  get nutritionItemsAvailable() {
    return !!this.nutritionItems;
  }

  currentDate() {
    return this.today();
  }

  async findNutritionItemsByDate(username, date) {
    const rows = await this.nutritionItems.findByDate(username, date);
    const today = this.today();
    return rows.map((row) => ({ ...row, ...presentSettlement(row, today) }));
  }

  async readNutritionDay(username, date) {
    const snapshot = this.nutritionItems.readDaySnapshot
      ? this.nutritionItems.readDaySnapshot(username, date)
      : { date, items: await this.nutritionItems.findByDate(username, date), revision: null };
    return { ...snapshot, items: snapshot.items.map(row => ({ ...row, ...presentSettlement(row, this.today()) })) };
  }

  findNutritionItem(username, id) {
    return this.nutritionItems.findByUuid(username, id);
  }

  async createNutritionItem(username, itemData) {
    const item = {
      uuid: this.newId(),
      userId: username,
      item: itemData.item || itemData.name,
      name: itemData.name || itemData.item,
      unit: itemData.unit || 'g',
      amount: itemData.amount || itemData.grams || 0,
      grams: foodGrams(itemData),
      noom_color: itemData.noom_color || itemData.color || 'yellow',
      color: itemData.color || itemData.noom_color || 'yellow',
      calories: itemData.calories || 0,
      fat: itemData.fat || 0,
      carbs: itemData.carbs || 0,
      protein: itemData.protein || 0,
      fiber: itemData.fiber || 0,
      sugar: itemData.sugar || 0,
      sodium: itemData.sodium || 0,
      cholesterol: itemData.cholesterol || 0,
      date: itemData.date || this.today(),
      log_uuid: itemData.log_uuid || 'MANUAL',
    };
    await this.nutritionItems.saveMany([item]);
    return item;
  }

  /**
   * @param {string} username
   * @param {string} id
   * @param {object} changes
   * @param {{ratify?: boolean}} [options] `ratify: false` writes the fields WITHOUT the
   *   human-review stamp. Exactly one caller needs it: the kitchen-scale re-pair, which
   *   corrects an entry's GRAMS from a measurement and — when no density was scanned —
   *   deliberately leaves the CALORIES as the machine estimated them. Stamping that row
   *   `settled: true` would certify a calorie figure nobody looked at, and would remove
   *   the "Unconfirmed" badge and the Confirm affordance that ask them to. A person
   *   correcting which meal a measurement belongs to has not reviewed that meal's
   *   estimate.
   */
  async updateNutritionItem(username, id, changes, options = {}) {
    for (const key of [...NUTRIENT_KEYS, 'grams']) {
      if (changes[key] != null && (typeof changes[key] !== 'number' || !Number.isFinite(changes[key]) || changes[key] < 0)) {
        throw Object.assign(new Error(`${key} must be a non-negative number`), { status: 400 });
      }
    }
    if (Object.hasOwn(changes, 'mealTime') && changes.mealTime != null && !['morning', 'afternoon', 'evening', 'night'].includes(changes.mealTime)) {
      throw Object.assign(new Error('Invalid meal'), { status: 400 });
    }
    const existing = await this.nutritionItems.findByUuid(username, id);
    if (!existing) return null;
    const ratify = options.ratify !== false;
    // Any successful edit is a human touch ratifying the machine's estimate —
    // settle the row. A body of just `{ settled: true }` (the one-tap
    // confirm) flows through this same stamp. Never conditional/defaulted:
    // this is an explicit write, not a fallback. The stamp is merged BEFORE
    // the whitelist filter (not after) so NUTRITION_UPDATE_FIELDS stays the
    // single real gate on what reaches the store — settled/settledBy/settledAt
    // must be present in that Set or this stamp is silently dropped too.
    //
    // `ratify: false` omits the stamp entirely rather than writing `settled: false`:
    // an ABSENT `settled` key means "legacy row, treat as settled", so writing a value
    // here would change the meaning of rows that never carried one. Omitting leaves
    // whatever the row already said — an unreviewed estimate stays unreviewed, a
    // confirmed row stays confirmed.
    const stampedChanges = ratify
      ? {
        ...changes,
        settled: true,
        settledBy: 'user',
        settledAt: nowTs24(),
      }
      : { ...changes };
    const allowedChanges = Object.fromEntries(
      Object.entries(stampedChanges).filter(([field]) => NUTRITION_UPDATE_FIELDS.has(field)),
    );
    if (changes.factor != null) Object.assign(allowedChanges, scaleFoodPortion(existing, changes.factor));
    if (changes.grams != null && existing.kind !== 'group' && foodGrams(existing)) {
      // Exact mass changes and multipliers share the same extensive arithmetic.
      Object.assign(allowedChanges, scaleFoodPortion(existing, changes.grams / foodGrams(existing)),
        Object.fromEntries(Object.entries(changes).filter(([field]) => NUTRITION_UPDATE_FIELDS.has(field))));
    }
    if (Array.isArray(changes.correctedNutrients)) {
      allowedChanges.nutrientProvenance = { ...existing.nutrientProvenance };
      for (const key of changes.correctedNutrients.filter(key => NUTRIENT_KEYS.includes(key))) {
        if (!Object.hasOwn(allowedChanges, key)) continue;
        if (allowedChanges[key] === null) delete allowedChanges.nutrientProvenance[key];
        else allowedChanges.nutrientProvenance[key] = { source: 'user', grams: allowedChanges.grams ?? foodGrams(existing), at: nowTs24() };
      }
    }
    if (typeof this.nutritionItems.mutateEntries === 'function') {
      const siblings = existing.kind === 'group' ? await this.nutritionItems.findByDate(username, existing.date) : [];
      const children = siblings.filter(child => child.parentId != null && (child.parentId === existing.id || child.parentId === existing.uuid));
      const updates = [{ id, changes: allowedChanges, expectedVersion: changes.expectedVersion ?? existing.version ?? 1 }];
      for (const child of children) {
        const childChanges = {};
        for (const key of ['mealTime', 'date']) if (Object.hasOwn(allowedChanges, key)) childChanges[key] = allowedChanges[key];
        if (changes.factor != null) Object.assign(childChanges, scaleFoodPortion(child, changes.factor));
        if (Object.keys(childChanges).length) updates.push({ id: child.uuid ?? child.id, changes: childChanges, expectedVersion: child.version ?? 1 });
      }
      const result = await this.nutritionItems.mutateEntries(username, { updates });
      return { item: result.items[0], changedFields: Object.keys(allowedChanges),
        cascadedIds: result.affectedIds.filter(value => value !== (existing.uuid ?? existing.id)),
        affectedDates: result.affectedDates };
    }
    const item = await this.nutritionItems.update(username, id, allowedChanges);
    const cascadedIds = await this.#cascadeMealTimeToChildren(username, existing, allowedChanges);
    return {
      item,
      changedFields: Object.keys(allowedChanges),
      cascadedIds,
    };
  }

  /**
   * A `mealTime` move on a GROUP row ("move this dish to Dinner") must carry
   * its children with it — the UI shows a group as one collapsed unit, so a
   * child left behind in the old bucket would be a silent, confusing
   * regression. Gated deliberately narrow:
   *  - only when `mealTime` is actually one of the fields this edit touched
   *    (a rename or a portion edit on a group must NOT go move its children);
   *  - only when the EDITED row's own `kind` is `'group'` — never inferred
   *    from "does anything reference this row as a parent", so an ordinary
   *    item update can never accidentally cascade even if some unrelated
   *    row happens to carry a matching parentId.
   * Runs client-of-one call at a time is not required here (this is one
   * server-side operation, not N client PUTs) — a client-side loop is
   * exactly what this method exists to replace, so a mid-way failure here
   * cannot leave the day half-moved from the browser's point of view.
   *
   * CROSS-REFERENCE: EntryEditSheet.jsx's group mode gates the exact same
   * way (`row.kind === 'group'`), while LogTable.jsx's group PRESENTATION
   * gates the opposite way — on "does this row have resolved children" —
   * by design (a row can carry children without being marked kind:'group'
   * and LogTable must still show them). The two decisions are equivalent
   * today only because every write path stamps kind:'group' before a row
   * is ever given children (groupParsedItems.mjs) — keep this gate and
   * EntryEditSheet.jsx's in sync if that invariant ever changes.
   * @private
   */
  async #cascadeMealTimeToChildren(username, groupRow, allowedChanges) {
    if (groupRow.kind !== 'group') return [];
    if (!Object.prototype.hasOwnProperty.call(allowedChanges, 'mealTime')) return [];
    if (groupRow.date == null) return [];

    const siblings = await this.nutritionItems.findByDate(username, groupRow.date);
    const children = (siblings || []).filter((row) => {
      if (row.parentId == null) return false;
      return row.parentId === groupRow.id || row.parentId === groupRow.uuid;
    });

    await Promise.all(children.map((child) => (
      this.nutritionItems.update(username, child.uuid ?? child.id, { mealTime: allowedChanges.mealTime })
    )));

    return children.map((child) => child.uuid ?? child.id);
  }

  async deleteNutritionItem(username, id) {
    const existing = await this.nutritionItems.findByUuid(username, id);
    if (!existing) return { found: false, deleted: false };
    if (typeof this.nutritionItems.mutateEntries === 'function') {
      const siblings = existing.kind === 'group' ? await this.nutritionItems.findByDate(username, existing.date) : [];
      const children = siblings.filter(child => child.parentId != null && (child.parentId === existing.id || child.parentId === existing.uuid));
      const result = await this.nutritionItems.mutateEntries(username, { deleteIds: [id, ...children.map(child => child.uuid ?? child.id)] });
      return { found: true, deleted: true, ...result };
    }
    return { found: true, deleted: await this.nutritionItems.deleteById(username, id) };
  }

  async copyNutritionItems(username, { entryIds, date, mealTime, operationId }) {
    if (!Array.isArray(entryIds) || !entryIds.length || !isISODate(date) || typeof operationId !== 'string' || operationId.length > 128) {
      throw Object.assign(new Error('Copy requires entry IDs, destination date and operation ID'), { status: 400 });
    }
    if (!['morning', 'afternoon', 'evening', 'night'].includes(mealTime)) throw Object.assign(new Error('Invalid meal'), { status: 400 });
    const sources = new Map();
    for (const id of entryIds) {
      const row = await this.nutritionItems.findByUuid(username, id);
      if (!row) throw Object.assign(new Error('An entry to copy is no longer available'), { status: 404 });
      sources.set(row.uuid || row.id, row);
      if (row.kind === 'group') {
        for (const child of await this.nutritionItems.findByDate(username, row.date)) {
          if (child.parentId != null && (child.parentId === row.id || child.parentId === row.uuid)) sources.set(child.uuid || child.id, child);
        }
      }
    }
    const ids = new Map();
    for (const row of sources.values()) {
      const next = uuidv5(`${username}:${operationId}:${row.uuid || row.id}`, uuidv5.URL);
      ids.set(row.uuid, next); ids.set(row.id, next);
    }
    const rows = [...sources.values()].map(row => ({ ...row,
      id: ids.get(row.uuid || row.id), uuid: ids.get(row.uuid || row.id), version: 1,
      userId: username, date, mealTime, parentId: row.parentId ? ids.get(row.parentId) || null : null,
      copiedFrom: row.uuid || row.id, logId: 'COPY', log_uuid: 'COPY',
      settled: true, settledBy: 'user', settledAt: nowTs24(),
    }));
    await this.nutritionItems.saveMany(rows);
    return { committed: true, items: rows, affectedIds: rows.map(row => row.uuid), affectedDates: [date] };
  }

  restoreNutritionItems(username, entryIds) {
    return this.nutritionItems.restoreEntries(username, entryIds);
  }

  get nutritionInputAvailable() {
    return !!this.nutritionInput;
  }

  /**
   * @param {Object} input
   * @param {string} input.type - "text" | "voice" | "image" | "barcode"
   * @param {string} [input.content]
   * @param {string} input.userId
   * @param {string} [input.bucket] - Pre-validated meal-time bucket id the
   *   capture was launched from (validated by the API router against the four
   *   known ids before this is ever called). Threaded straight through to the
   *   nutribot input pipeline, where the router seam applies the precedence:
   *   explicit-in-utterance/caption > bucket > clock default.
   */
  processNutritionInput({ type, content, userId, bucket, date, audioRef }) {
    return this.nutritionInput.process({ type, content, userId, bucket, date, audioRef });
  }

  runNutritionOperation(userId, operationId, payload, action) {
    return this.nutritionItems?.runOperation ? this.nutritionItems.runOperation(userId, operationId, payload, action) : action();
  }

  processNutritionCallback(input) {
    return this.nutritionInput.processCallback(input);
  }

  get pendingNutritionAvailable() {
    return typeof this.nutritionInput?.listPendingByDate === 'function';
  }

  listPendingNutrition(username, date) {
    return this.nutritionInput.listPendingByDate(username, date);
  }
}

export default HealthOperations;
