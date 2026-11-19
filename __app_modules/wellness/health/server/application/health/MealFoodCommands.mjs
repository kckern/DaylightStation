import { sha256Text } from '#system/utils/sha256.mjs';
import { v5 as uuidv5 } from 'uuid';
import { isISODate } from '../../../portable/contracts/health/isoDate.mjs';
import { MEAL_BUCKETS } from '../../../portable/contracts/health/mealBuckets.mjs';
import { NUTRIENT_KEYS, foodGrams, scaleFoodPortion } from '../../../portable/contracts/health/foodQuantity.mjs';

const idOf = row => row.uuid || row.id;
const linkIds = row => [row.uuid, row.id].filter(Boolean);
/** A dish part may name its dish by either ID. A uuid always wins over another row's short ID. */
export const indexByLinkId = rows => {
  const index = new Map(rows.filter(row => row.uuid).map(row => [row.uuid, row]));
  for (const row of rows) if (row.id && !index.has(row.id)) index.set(row.id, row);
  return index;
};
const canonicalId = (byLinkId, id) => { const row = byLinkId.get(id); return row ? idOf(row) : id; };
/**
 * The dish a row is really part of: its link resolves to a group in the row's own
 * meal. Callers pass one day's rows, so the date already matches. Any other link
 * is broken, and the row stands on its own.
 */
export const dishOf = (row, byLinkId) => {
  const parent = row.parentId ? byLinkId.get(row.parentId) : null;
  return parent && parent !== row && parent.kind === 'group' && mealRowBucket(parent) === mealRowBucket(row) ? parent : null;
};
/** True when a row's link breaks a dish rule, read across the whole ledger. */
const linkBroken = (row, byLinkId) => {
  const parent = byLinkId.get(row.parentId);
  return !parent || parent.kind !== 'group' || Boolean(parent.parentId) || row.kind === 'group' || parent.date !== row.date || mealRowBucket(parent) !== mealRowBucket(row);
};
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const operationPattern = /^[A-Za-z0-9_-]{1,128}$/;
const FOOD_COLORS = ['green', 'yellow', 'orange'];
const fields = new Set(['name', 'color', 'grams', 'amount', 'unit', ...NUTRIENT_KEYS]);
const fingerprint = value => sha256Text(JSON.stringify(value));
const isMeal = meal => MEAL_BUCKETS.some(bucket => bucket.id === meal);
const isPlainObject = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function mealRowBucket(row) {
  return row.mealTime || null;
}
function validateChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('Invalid food changes');
  for (const [key, value] of Object.entries(changes)) {
    if (!fields.has(key)) fail(`Unsupported food field: ${key}`);
    if (key === 'name' || key === 'unit') {
      if (typeof value !== 'string' || !value.trim() || value.length > 250) fail(`Invalid ${key}`);
    } else if (key === 'color') {
      if (!FOOD_COLORS.includes(value)) fail('Invalid color');
    } else if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail(`Invalid ${key}`);
  }
  return changes;
}

function amendmentPatch(row, requested, { voiceCorrection = false } = {}) {
  validateChanges(requested);
  let factor = null;
  let amountBased = false;
  const mass = foodGrams(row);
  if (requested.grams != null && mass !== null) factor = requested.grams / mass;
  else if (requested.amount != null) {
    const unit = requested.unit || row.unit;
    if (unit !== row.unit || !(row.amount > 0)) fail('A portion change requires a quantity in the existing unit');
    factor = requested.amount / row.amount;
    amountBased = true;
  }
  let scaled = {};
  if (factor !== null) {
    if (!Number.isFinite(factor) || factor <= 0) fail('Portion factor must be positive');
    scaled = scaleFoodPortion(row, factor);
    // Keep the established extensive-quantity semantics without presentation rounding.
    for (const key of NUTRIENT_KEYS) if (Number.isFinite(row[key])) scaled[key] = row[key] * factor;
    if (mass !== null) Object.assign(scaled, { grams: mass * factor, amount: mass * factor });
    else if (Number.isFinite(row.amount)) scaled.amount = row.amount * factor;
    if (amountBased) Object.assign(scaled, { amount: row.amount * factor, unit: row.unit });
  }
  const patch = { ...scaled, ...requested };
  const changed = Object.keys(patch).filter(key => JSON.stringify(patch[key]) !== JSON.stringify(row[key]));
  if (changed.length) patch.manualFields = [...new Set([...(row.manualFields || []), ...changed])];
  // Still manual, so the auditor leaves them alone, but a later correction may replace them.
  if (changed.length && voiceCorrection) patch.revisedFields = [...new Set([...(row.revisedFields || []), ...changed])];
  return patch;
}

/** Meal-scoped, version-checked commands. All snapshots and replies commit with the ledger. */
export class MealFoodCommands {
  constructor({ nutritionItems, logger = {} }) { this.store = nutritionItems; this.logger = logger; }

  /** `options` comes from server code only; the HTTP body cannot reach it. */
  async execute(userId, input, options = {}) {
    const { date, bucket, action, operationId, selectedIds, expectedVersions } = input;
    if (!operationPattern.test(operationId || '') || !isISODate(date) || !MEAL_BUCKETS.some(b => b.id === bucket)) fail('A valid operation ID, date and meal bucket are required');
    if (!Array.isArray(selectedIds) || selectedIds.some(id => typeof id !== 'string') || new Set(selectedIds).size !== selectedIds.length) fail('Explicit unique selected food IDs are required');
    if (!expectedVersions || typeof expectedVersions !== 'object' || Array.isArray(expectedVersions)) fail('Expected versions are required');
    if (!['group', 'groups', 'membership', 'ungroup', 'amend'].includes(action)) fail('Invalid meal action');
    return this.store.runOperation(userId, operationId, { operation: 'meal-command', ...input }, async () => {
      const rows = await this.store.findByDate(userId, date);
      const byId = new Map(rows.map(row => [idOf(row), row]));
      const byLinkId = indexByLinkId(rows);
      const get = id => {
        const row = byId.get(id);
        if (!row || mealRowBucket(row) !== bucket) fail('Selected food is outside this meal');
        return row;
      };
      const selected = selectedIds.map(get);
      const updates = new Map(), creates = [], deleteIds = [];
      const checked = new Set();
      const check = row => {
        const id = idOf(row);
        if (expectedVersions[id] !== (row.version ?? 1)) fail('This entry changed. Reload before saving.', 409);
        checked.add(id);
      };
      const update = (row, changes) => { check(row); updates.set(idOf(row), { id: idOf(row), expectedVersion: row.version ?? 1, changes: { ...updates.get(idOf(row))?.changes, ...changes } }); };
      const groupHeader = (name, suffix = '') => {
        if (typeof name !== 'string' || !name.trim() || name.length > 250) fail('A group name is required');
        const uuid = uuidv5(`${userId}:${operationId}:group:${suffix}`, uuidv5.URL);
        const row = { uuid, userId, date, mealTime: bucket, kind: 'group', name: name.trim(), item: name.trim(), label: name.trim(), parentId: null, grams: 0, amount: 0, unit: 'g', ...Object.fromEntries(NUTRIENT_KEYS.map(key => [key, 0])) };
        creates.push(row); return row;
      };
      const requireFood = row => { if (row.kind === 'group' || rows.some(child => child.parentId === idOf(row))) fail('Groups cannot be nested'); check(row); };
      if (action === 'groups') {
        if (!Array.isArray(input.groups) || !input.groups.length) fail('Groups are required');
        const used = new Set();
        for (const [index, proposal] of input.groups.entries()) {
          if (!Array.isArray(proposal.selectedIds) || proposal.selectedIds.length < 2) fail('Select at least two foods per group');
          const members = proposal.selectedIds.map(id => {
            if (!selectedIds.includes(id) || used.has(id)) fail('Group memberships overlap or exceed selection');
            used.add(id); const row = get(id); requireFood(row); return row;
          });
          const parent = groupHeader(proposal.name, String(index));
          members.forEach(row => update(row, { parentId: idOf(parent) }));
        }
      } else if (action === 'group') {
        if (selected.length < 2) fail('Select at least two foods');
        selected.forEach(requireFood);
        const parent = groupHeader(input.name);
        selected.forEach(row => update(row, { parentId: idOf(parent) }));
      } else if (action === 'membership' || action === 'ungroup') {
        const parent = get(input.groupId); check(parent);
        if (parent.kind !== 'group' || parent.parentId) fail('Invalid group');
        selected.forEach(requireFood);
        const desired = new Set(action === 'ungroup' ? [] : selectedIds);
        for (const row of rows.filter(row => byLinkId.get(row.parentId) === parent)) { get(idOf(row)); update(row, { parentId: desired.has(idOf(row)) ? idOf(parent) : null }); }
        for (const row of selected) if (desired.has(idOf(row))) update(row, { parentId: idOf(parent) });
        if (!desired.size) deleteIds.push(idOf(parent));
        else update(parent, input.name === undefined ? {} : validateChanges({ name: input.name }));
      } else {
        selected.forEach(check);
        for (const [id, changes] of Object.entries(input.changes || {})) {
          if (!selectedIds.includes(id)) fail('Amendment exceeds selection');
          // Only a dish holds parts, so a stray link to this food does not make it one.
          const row = get(id); if (row.kind === 'group') fail('Groups cannot be nested');
          update(row, amendmentPatch(row, changes, options));
        }
        if (input.additions !== undefined && !Array.isArray(input.additions)) fail('Invalid additions');
        const promoted = new Map();
        for (const [index, addition] of (input.additions || []).entries()) {
          const { parentId, ...values } = addition;
          validateChanges(values);
          if (!values.name || !Number.isFinite(values.calories)) fail('Added food requires a name and calories');
          let destination = null;
          if (parentId) {
            if (!selectedIds.includes(parentId)) fail('Addition exceeds selection');
            const parent = get(parentId); check(parent);
            if (parent.kind === 'group') destination = parentId;
            else if (parent.parentId) { const group = get(parent.parentId); check(group); destination = idOf(group); }
            else {
              if (!promoted.has(parentId)) { const header = groupHeader(input.name || parent.name || parent.item, parentId); promoted.set(parentId, idOf(header)); update(parent, { parentId: idOf(header) }); }
              destination = promoted.get(parentId);
            }
          }
          creates.push({ ...values, uuid: uuidv5(`${userId}:${operationId}:addition:${index}`, uuidv5.URL), userId, date, mealTime: bucket, parentId: destination, kind: 'food' });
        }
        // A dish revision ("it didn't have noodles") deletes parts outright —
        // the only place an amend removes food, and only foods it was shown.
        if (input.removals !== undefined && !Array.isArray(input.removals)) fail('Invalid removals');
        for (const id of input.removals || []) {
          if (typeof id !== 'string' || !selectedIds.includes(id)) fail('Removal exceeds selection');
          const row = get(id); requireFood(row);
          if (!deleteIds.includes(id)) deleteIds.push(id);
        }
      }
      // Retire headers made empty by reassignment or removal. Foods are deleted
      // only by an amend's explicit removals above.
      // An amend leaves links alone, so only a real dish of an amended food matters:
      // a broken link names a parent that has nothing to do with this change.
      const relinked = [...updates.values()].map(u => byId.get(u.id)).filter(row => row && (action !== 'amend' || dishOf(row, byLinkId)));
      const oldParents = new Set([...relinked, ...deleteIds.map(id => byId.get(id))].map(row => row?.parentId)
        .filter(Boolean).map(id => canonicalId(byLinkId, id)));
      for (const parentId of oldParents) {
        const parent = get(parentId); check(parent);
        const remaining = rows.some(row => {
          if (deleteIds.includes(idOf(row))) return false;
          const changes = updates.get(idOf(row))?.changes;
          return byLinkId.get(changes && Object.hasOwn(changes, 'parentId') ? changes.parentId : row.parentId) === parent;
        }) || creates.some(row => row.parentId === parentId);
        if (!remaining && !deleteIds.includes(parentId)) deleteIds.push(parentId);
      }
      const undoToken = `meal-${uuidv5(`${userId}:${operationId}`, uuidv5.URL)}`;
      const audit = { id: undoToken, fingerprint: fingerprint(input), type: 'meal-command', date, bucket };
      const result = await this.store.mutateEntries(userId, {
        updates: [...updates.values()].filter(u => !deleteIds.includes(u.id)), creates, deleteIds, allowFoodCreates: action === 'amend',
        audit,
        resultMeta: { committed: true, date, bucket, undoToken },
        validate: ({ before, after }) => {
          for (const id of checked) {
            const raw = before.find(row => idOf(row) === id);
            if (!raw || (raw.version ?? 1) !== expectedVersions[id]) fail('This meal changed. Reload before saving.', 409);
          }
          if (action !== 'amend') { this.validateGraph(after); return; }
          // An amend answers only for the rows it touches. Links that were already
          // broken stay as they are, and join the audit so Undo accepts them too.
          const touched = new Set([...updates.keys(), ...deleteIds, ...creates.map(idOf)]);
          const links = new Set(before.filter(row => touched.has(idOf(row))).flatMap(linkIds));
          const beforeByLink = indexByLinkId(before);
          audit.brokenLinkIds = before.filter(row => row.parentId && (touched.has(idOf(row)) || links.has(row.parentId)) && linkBroken(row, beforeByLink)).map(idOf);
          this.validateGraph(after, new Set([...touched, ...links]), new Set(audit.brokenLinkIds));
        },
      });
      this.logger.info?.('health.meal.command', { userId, action, operationId, affectedIds: result.affectedIds });
      return result;
    });
  }

  /**
   * What a move changes on each row, by ID. A selected food with a broken link
   * moves loose and loses the link; a selected dish brings every row linked to it
   * that day, so a part stranded in another meal rejoins it. A plain food brings
   * only the rows linked to it in its own meal.
   */
  #planMove(rows, selectedIds, destination, toMeal) {
    const byId = new Map(rows.map(row => [idOf(row), row]));
    const byLinkId = indexByLinkId(rows);
    const selected = selectedIds.map(id => {
      const row = byId.get(id);
      if (!row) fail('Selected food is outside this day');
      if (dishOf(row, byLinkId)) fail('Move the whole dish, not one of its parts');
      return row;
    });
    const plan = new Map(selected.map(row => [idOf(row), { row, changes: { ...destination, ...(row.parentId ? { parentId: null } : {}) } }]));
    const reunites = new Set();
    for (const header of selected) {
      const meal = toMeal ?? mealRowBucket(header);
      for (const part of rows) {
        if (part === header || !part.parentId || byLinkId.get(part.parentId) !== header) continue;
        if (header.kind !== 'group' && mealRowBucket(part) !== mealRowBucket(header)) continue;
        const strayed = mealRowBucket(part) !== meal;
        if (strayed) reunites.add(header);
        plan.set(idOf(part), { row: part, changes: { ...destination, ...(strayed ? { mealTime: meal } : {}),
          // Only a dish can hold parts; a link to anything else is dropped.
          ...(header.kind === 'group' ? {} : { parentId: null }) } });
      }
    }
    const brokenLinkIds = [...plan.values()].filter(({ row }) => row.parentId && !dishOf(row, byLinkId)).map(({ row }) => idOf(row));
    return { selected, plan, reunites, brokenLinkIds };
  }

  /** Move foods to another day and/or meal: all of them or none, with one Undo. */
  async moveFoods(userId, input) {
    const { operationId, date, selectedIds, expectedVersions, toDate = null, toMeal = null, today } = input;
    if (!operationPattern.test(operationId || '') || !isISODate(date)) fail('A valid operation ID and date are required');
    if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => typeof id !== 'string') || new Set(selectedIds).size !== selectedIds.length) fail('Explicit unique selected food IDs are required');
    if (!expectedVersions || typeof expectedVersions !== 'object' || Array.isArray(expectedVersions)) fail('Expected versions are required');
    if (!toDate && !toMeal) fail('A destination day or meal is required');
    if (toDate && (!isISODate(toDate) || !isISODate(today) || toDate > today)) fail('Food cannot move to that day');
    if (toMeal && !isMeal(toMeal)) fail('Invalid meal');
    return this.store.runOperation(userId, operationId, { operation: 'foods-move', date, selectedIds, expectedVersions, toDate, toMeal }, async () => {
      const rows = await this.store.findByDate(userId, date);
      const destination = { ...(toDate ? { date: toDate } : {}), ...(toMeal ? { mealTime: toMeal } : {}) };
      const { selected, plan, reunites, brokenLinkIds } = this.#planMove(rows, selectedIds, destination, toMeal);
      for (const { row } of plan.values()) if (expectedVersions[idOf(row)] !== (row.version ?? 1)) fail('This entry changed. Reload before saving.', 409);
      const dayChanges = Boolean(toDate) && toDate !== date;
      const movedCount = dayChanges || toMeal ? selected.filter(row => dayChanges || mealRowBucket(row) !== toMeal || reunites.has(row)).length : 0;
      if (!movedCount) fail('These foods are already there');
      const updates = [...plan.values()].map(({ row, changes }) => ({ id: idOf(row), expectedVersion: row.version ?? 1, changes }));
      const undoToken = `meal-${uuidv5(`${userId}:${operationId}`, uuidv5.URL)}`;
      const audit = { id: undoToken, fingerprint: fingerprint(input), type: 'meal-command', date, bucket: null, brokenLinkIds };
      const movedLinks = new Set([...plan.values()].flatMap(({ row }) => linkIds(row)));
      const result = await this.store.mutateEntries(userId, { updates, audit,
        resultMeta: { committed: true, date, bucket: null, undoToken, toDate, toMeal, movedCount },
        validate: ({ before, after }) => {
          // Rows left behind whose link to a moved row was already broken, such as
          // a part on another day. Only the whole ledger shows them, so they join
          // the audit here, before it is written, for Undo to accept them too.
          const byLinkId = indexByLinkId(before);
          const leftBroken = before.filter(row => row.parentId && !plan.has(idOf(row)) && movedLinks.has(row.parentId) && linkBroken(row, byLinkId)).map(idOf);
          audit.brokenLinkIds = [...brokenLinkIds, ...leftBroken];
          this.validateGraph(after, new Set(updates.map(update => update.id)), new Set(leftBroken));
        },
      });
      this.logger.info?.('health.foods.move', { userId, operationId, date, toDate, toMeal, count: movedCount });
      return result;
    });
  }

  /**
   * Spread a fresh capture across meals. Undo removes the capture, because to
   * the person this was one act of logging. Every row is stamped so each joins
   * the audit, including rows already in the right meal. Only an untouched
   * capture qualifies, so that Undo cannot delete later edits.
   */
  async placeCapturedFoods(userId, { operationId, logId, placements = {} }) {
    if (!operationPattern.test(operationId || '') || !logId) fail('A valid operation ID and capture are required');
    if (!isPlainObject(placements) || !Object.values(placements).every(isMeal)) fail('Invalid meal placements');
    return this.store.runOperation(userId, operationId, { operation: 'capture-place', logId, placements }, async () => {
      const rows = await this.store.findByLogId(userId, logId);
      if (!rows.length) fail('Capture not found', 404);
      if (rows.some(row => (row.version ?? 1) !== 1)) fail('This capture changed. Reload before placing it.', 409);
      const topLevelIds = new Set(rows.filter(row => !row.parentId).map(idOf));
      if (Object.keys(placements).some(id => !topLevelIds.has(id))) fail('Placed food is not a top-level food of this capture');
      const byLinkId = indexByLinkId(rows);
      const mealOf = row => placements[canonicalId(byLinkId, row.parentId)] || placements[idOf(row)] || row.mealTime || null;
      const updates = rows.map(row => ({ id: idOf(row), expectedVersion: row.version ?? 1, changes: { mealTime: mealOf(row), placedBy: operationId } }));
      const undoToken = `meal-${uuidv5(`${userId}:${operationId}`, uuidv5.URL)}`;
      const date = rows[0].date;
      const result = await this.store.mutateEntries(userId, { updates, auditCreated: true,
        audit: { id: undoToken, fingerprint: fingerprint({ logId, placements }), type: 'meal-command', date, bucket: null },
        resultMeta: { committed: true, date, bucket: null, undoToken },
        validate: ({ after }) => this.validateGraph(after, new Set(updates.map(update => update.id))),
      });
      this.logger.info?.('health.capture.placed', { userId, operationId, logId, count: rows.length });
      return result;
    });
  }

  /**
   * Check dish links across `rows`, or only those touching `touchedIds` when
   * given. A part naming a touched ID stays in scope even when that dish is
   * gone, which is what an Undo that deletes a dish looks like. `allowedBroken`
   * names rows an Undo is putting back with the broken link they already had.
   */
  validateGraph(rows, touchedIds = null, allowedBroken = new Set()) {
    const byId = indexByLinkId(rows);
    for (const row of rows) if (row.parentId && !allowedBroken.has(idOf(row))) {
      const parent = byId.get(row.parentId);
      if (touchedIds && !touchedIds.has(idOf(row)) && !touchedIds.has(row.parentId) && !(parent && touchedIds.has(idOf(parent)))) continue;
      if (linkBroken(row, byId)) fail('Invalid group membership', 409);
    }
  }

  async undo(userId, { undoToken, operationId }) {
    if (!operationPattern.test(operationId || '') || typeof undoToken !== 'string' || !/^meal-[a-f0-9-]{36}$/.test(undoToken)) fail('Valid Undo token and operation ID are required');
    return this.store.runOperation(userId, operationId, { operation: 'meal-undo', undoToken }, async () => {
      const record = await this.store.getCleanupAudit(userId, undoToken);
      if (!record || record.type !== 'meal-command') fail('Undo not found', 404);
      const result = await this.store.mutateEntries(userId, { restoreAudit: undoToken,
        resultMeta: { committed: true, date: record.date, bucket: record.bucket, undoToken: null },
        validate: ({ before, after }) => {
          // A recorded broken link is excused only if Undo restores that row or the
          // link is still broken. A row repaired since then must not be split again.
          const affected = new Set(record.result.affectedIds);
          const byLinkId = indexByLinkId(before);
          const stillBroken = id => before.some(row => idOf(row) === id && row.parentId && linkBroken(row, byLinkId));
          const allowed = new Set((record.brokenLinkIds || []).filter(id => affected.has(id) || stillBroken(id)));
          this.validateGraph(after, new Set([...record.result.affectedIds, ...[...record.before, ...record.after].flatMap(linkIds)]), allowed);
        },
      });
      this.logger.info?.('health.meal.undo', { userId, operationId, affectedIds: result.affectedIds });
      return result;
    });
  }
}
