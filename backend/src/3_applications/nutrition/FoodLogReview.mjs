import { sha256Text } from '#system/utils/sha256.mjs';
import { serializeFoodItem } from '#shared/contracts/nutrition/foodItemRecord.mjs';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';
import { MealTimes } from '#domains/nutrition/entities/schemas.mjs';
import { scaleFoodPortion } from '#shared/contracts/health/foodQuantity.mjs';
import { nutritionLookupFor } from '#shared/contracts/nutrition/nutritionLookup.mjs';
import { FoodItem } from '#domains/nutrition/entities/FoodItem.mjs';
import { validateCleanup, entryKey, CLEANUP_FIELDS } from '#domains/nutrition/services/cleanupPolicy.mjs';

const nutrients = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
const editable = ['label', 'grams', 'amount', 'unit', ...nutrients];
export const nutritionLogVersion = log => sha256Text(JSON.stringify({
  status: log.status, meal: log.meal, items: log.items.map(serializeFoodItem), updatedAt: log.updatedAt, nutritionLookup: nutritionLookupFor(log),
}));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

/** One serialized, resumable command for pending food, independent of transport.
 * A durable intent precedes the idempotent ledger append. If either write fails,
 * the same command resumes; a competing surface cannot re-scale the intent.
 */ 
export class FoodLogReview {
  #foodLogs; #items; #logger; #queues = new Map();
  constructor({ foodLogs, items, logger }) { this.#foodLogs = foodLogs; this.#items = items; this.#logger = logger; }
  execute(input) {
    return this.runExclusive(input.userId, () => this.#execute(input));
  }
  runExclusive(userId, action) {
    const key = userId;
    const previous = this.#queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.#queues.set(key, next);
    return next.finally(() => { if (this.#queues.get(key) === next) this.#queues.delete(key); });
  }
  /** Pending cleanup uses the same queue as confirmation. The complete receipt
   * is persisted in the same FoodLog write; a restart never loses its evidence.
   */
  repair(input) {
    return this.runExclusive(input.userId, async () => {
      const { userId, logUuid, expectedVersion, operationId, fingerprint, proposal, creates = [], evidence, runId, userDirected, clock, timezone, signal, fence, dryRun = false } = input;
      const log = await this.#foodLogs.findById(userId, logUuid);
      if (!log) fail('Capture not found', 404);
      const prior = log.metadata?.cleanupAudit?.[operationId];
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('Operation ID already used', 409);
        return prior.result;
      }
      if (log.status !== 'pending' || nutritionLogVersion(log) !== expectedVersion || log.metadata?.reviewOperation?.complete === false) fail('Capture changed before cleanup', 409);
      const before = log.items.map(item => ({ ...serializeFoodItem(item), version: 1, date: log.meal.date, mealTime: log.meal.time, logUuid }));
      const updates = structuredClone(proposal.updates || []);
      // Pending date/meal edits must apply to the complete capture.
      const date = updates.find(u => u.changes.date)?.changes.date || log.meal.date;
      const mealTime = updates.find(u => u.changes.mealTime)?.changes.mealTime || log.meal.time;
      if ((date !== log.meal.date || mealTime !== log.meal.time) && updates.length !== before.length) fail('Move the complete pending capture', 409);
      const after = before.map(row => {
        const change = updates.find(u => u.id === row.id || u.id === row.uuid)?.changes || {};
        return { ...row, ...change, ...(change.name ? { label: change.name } : {}) };
      }).concat(creates.map(row => ({ ...row, version: 1 })));
      if (after.some(row => row.date !== date || row.mealTime !== mealTime)) fail('Move the complete pending capture consistently', 409);
      signal?.throwIfAborted();
      if (!fence()) fail('Repair is no longer active', 409);
      validateCleanup({ before, after, updates, creates, evidence, now: clock.now(), timezone, userId, userDirected });
      for (const update of updates) {
        const row = after.find(row => row.id === update.id || row.uuid === update.id);
        const original = before.find(row => row.id === update.id || row.uuid === update.id);
        const fields = Object.keys(update.changes).filter(key => JSON.stringify(original[key]) !== JSON.stringify(row[key]));
        if (!fields.length) continue;
        const key = userDirected ? 'manualFields' : 'cleanupFields';
        row[key] = [...new Set([...(row[key] || []), ...fields])];
      }
      const items = after.map(row => new FoodItem(row));
      if (dryRun || JSON.stringify(log.items.map(serializeFoodItem)) === JSON.stringify(items.map(serializeFoodItem))) return { items: [], affectedIds: [], affectedDates: [], dryRun };
      const result = { items: after, affectedIds: after.map(entryKey), affectedDates: [...new Set([date, log.meal.date])], logUuid };
      const receipt = { id: operationId, runId, fingerprint, before, after, reason: proposal.reason, evidence,
        actor: userDirected ? 'user-answer' : 'nutrition-auditor', at: new Date(clock.now()).toISOString(), result };
      const savedAt = new Date(clock.now());
      const updated = log.with({ items, meal: { ...log.meal, date, time: mealTime } }, savedAt);
      receipt.afterVersion = nutritionLogVersion(updated);
      await this.#foodLogs.save(updated.with({ metadata: { ...log.metadata, cleanupAudit: { ...log.metadata?.cleanupAudit, [operationId]: receipt } } }, savedAt));
      return result;
    });
  }
  undoRepair({ userId, repairId, clock }) {
    return this.runExclusive(userId, async () => {
      const log = (await this.#foodLogs.findAll(userId, { includeArchives: true })).find(log => log.metadata?.cleanupAudit?.[repairId]);
      if (!log) fail('Repair not found', 404);
      const undoId = 'undo_' + repairId;
      if (log.metadata.cleanupAudit[undoId]) return log.metadata.cleanupAudit[undoId].result;
      const repair = log.metadata.cleanupAudit[repairId];
      if (log.status !== 'pending' || nutritionLogVersion(log) !== repair.afterVersion) fail('Capture changed after cleanup; edit it manually instead', 409);
      const restored = repair.before.map(row => {
        const after = repair.after.find(item => entryKey(item) === entryKey(row));
        return { ...row, manualFields: [...new Set([...(row.manualFields || []), ...CLEANUP_FIELDS.filter(key => JSON.stringify(row[key]) !== JSON.stringify(after?.[key]))])] };
      });
      const result = { items: restored, affectedDates: [...new Set([...repair.before, ...repair.after].map(row => row.date))], logUuid: log.id };
      const receipt = { id: undoId, undoOf: repairId, actor: 'user', reason: 'Undo cleanup', evidence: [], before: repair.after, after: restored, at: new Date(clock.now()).toISOString(), result };
      await this.#foodLogs.save(log.with({ items: restored.map(row => new FoodItem(row)),
        meal: { ...log.meal, date: restored[0]?.date || log.meal.date, time: restored[0]?.mealTime || log.meal.time },
        metadata: { ...log.metadata, cleanupAudit: { ...log.metadata.cleanupAudit, [undoId]: receipt } } }, new Date(clock.now())));
      return result;
    });
  }
  async #execute(input) {
    const { userId, logUuid, action = 'confirm', expectedVersion, operationId,
      portionFactor = 1, items: edits = [], date, mealTime, nutritionReviewed = false } = input;
    if (!['save', 'confirm', 'discard'].includes(action)) fail('Unknown review action');
    if (!Number.isFinite(portionFactor) || portionFactor <= 0 || portionFactor > 100) fail('Invalid portion');
    if (date !== undefined && !isISODate(date)) fail('Invalid date');
    if (mealTime !== undefined && !MealTimes.includes(mealTime)) fail('Invalid meal');
    if (!Array.isArray(edits)) fail('Items must be an array');
    if (typeof nutritionReviewed !== 'boolean') fail('Nutrition review acknowledgement must be a boolean');
    let log = await this.#foodLogs.findById(userId, logUuid);
    if (!log) fail('Food log not found', 404);
    const requestHash = sha256Text(JSON.stringify({ action, portionFactor, edits, date, mealTime, nutritionReviewed }));
    const prior = log.metadata?.reviewOperation;
    const sameOperation = !!operationId && prior?.id === operationId;
    if (sameOperation && prior.hash !== requestHash) fail('Operation ID was reused for a different change', 409);
    if (sameOperation && prior.complete) return { success: true, logUuid, status: log.status, version: nutritionLogVersion(log) };
    if (prior && !prior.complete && !sameOperation) {
      // Finish an interrupted confirmation before evaluating a competing action.
      await this.#finish(userId, log);
      fail('This capture was already reviewed. Reload to see the current record.', 409);
    }
    if (!sameOperation && expectedVersion && expectedVersion !== nutritionLogVersion(log)) fail('This capture changed. Reload before reviewing it.', 409);
    if (!sameOperation && log.status !== 'pending') {
      if (!expectedVersion && log.status === 'accepted' && action === 'confirm') return { success: true, logUuid, status: log.status, alreadyProcessed: true };
      fail('This capture was already reviewed. Reload to see the current record.', 409);
    }
    if (!sameOperation) {
      const ids = new Set(log.items.map(item => item.id));
      const seen = new Set();
      for (const edit of edits) {
        if (!ids.has(edit.id) || seen.has(edit.id)) fail('Unknown or repeated food item');
        seen.add(edit.id);
        if (Object.keys(edit).some(key => key !== 'id' && !editable.includes(key))) fail('Unsupported food edit');
        for (const key of nutrients) if (edit[key] !== undefined && (!Number.isFinite(edit[key]) || edit[key] < 0)) fail('Nutrients must be nonnegative numbers');
      }
      const lookup = nutritionLookupFor(log);
      if (action === 'confirm' && lookup?.warnings?.length && !nutritionReviewed && !lookup.reviewed) fail('Review the product nutrition warning before confirming');
      if (action === 'confirm' && lookup?.missing?.includes('calories')
        && !edits.some(edit => Number.isFinite(edit.calories))) fail('Enter the calories from the product label before confirming');
      let items = log.items.map(item => {
        const edit = edits.find(candidate => candidate.id === item.id) || {};
        const { id: _id, ...changes } = edit;
        const scaled = portionFactor !== 1 && item.kind !== 'group' ? scaleFoodPortion(item, portionFactor) : {};
        const nutrientProvenance = { ...item.nutrientProvenance };
        for (const key of ['fiber', 'sugar', 'sodium', 'cholesterol']) {
          if (changes[key] !== undefined) nutrientProvenance[key] = { source: 'user', grams: changes.grams ?? scaled.grams ?? item.grams, at: new Date().toISOString() };
        }
        const manualFields = [...new Set([...(item.manualFields || []), ...Object.keys(scaled), ...Object.keys(changes),
          ...(date && date !== log.meal.date ? ['date'] : []), ...(mealTime && mealTime !== log.meal.time ? ['mealTime'] : [])])];
        try { return item.with({ ...scaled, ...changes, nutrientProvenance, manualFields }); }
        catch { fail('Invalid food quantity or nutrition. Check the edited fields.'); }
      });
      items = items.map(item => {
        if (item.kind !== 'group') return item;
        const children = items.filter(child => child.parentId === item.id || child.parentId === item.uuid);
        const grams = children.length && children.every(child => child.grams > 0)
          ? children.reduce((sum, child) => sum + child.grams, 0) : null;
        return item.with({ grams, amount: grams || 1, ...Object.fromEntries(nutrients.map(key => [key, 0])) });
      });
      log = log.with({ items, meal: { ...log.meal, ...(date ? { date } : {}), ...(mealTime ? { time: mealTime } : {}) },
        metadata: { ...log.metadata,
          ...(lookup ? { nutritionLookup: { ...lookup,
            reviewed: nutritionReviewed || lookup.reviewed || false,
            missing: (lookup.missing || []).filter(key => !edits.some(edit => Number.isFinite(edit[key]))),
          } } : {}),
          reviewOperation: { id: operationId || `review:${nutritionLogVersion(log)}:${action}`, hash: requestHash, action, complete: action === 'save' } },
      }, new Date());
      await this.#foodLogs.save(log);
    }
    if (action !== 'save') log = await this.#finish(userId, log);
    this.#logger?.info?.('nutrition.review.completed', { userId, logUuid, action });
    return { success: true, logUuid, status: log.status, version: nutritionLogVersion(log) };
  }
  async #finish(userId, log) {
    const operation = log.metadata.reviewOperation;
    if (operation.action === 'confirm') {
      await this.#items.saveMany(log.items.map(item => ({
        ...serializeFoodItem(item), userId, logUuid: log.id, date: log.meal.date, mealTime: log.meal.time,
      })));
      log = log.accept(new Date());
    } else if (operation.action === 'discard') {
      log = log.with({ status: 'deleted' }, new Date());
    }
    log = log.with({ metadata: { ...log.metadata, reviewOperation: { ...operation, complete: true } } }, new Date());
    await this.#foodLogs.save(log);
    return log;
  }
}
