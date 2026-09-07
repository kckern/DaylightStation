import { sha256Text } from '#system/utils/sha256.mjs';
import { v5 as uuidv5 } from 'uuid';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';
import { MEAL_BUCKETS } from '#shared/contracts/health/mealBuckets.mjs';
import { NUTRIENT_KEYS, foodGrams, scaleFoodPortion } from '#shared/contracts/health/foodQuantity.mjs';

const idOf = row => row.uuid || row.id;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const operationPattern = /^[A-Za-z0-9_-]{1,128}$/;
const fields = new Set(['name', 'grams', 'amount', 'unit', ...NUTRIENT_KEYS]);
const fingerprint = value => sha256Text(JSON.stringify(value));
export function mealRowBucket(row) {
  return row.mealTime || null;
}
function validateChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('Invalid food changes');
  for (const [key, value] of Object.entries(changes)) {
    if (!fields.has(key)) fail(`Unsupported food field: ${key}`);
    if (key === 'name' || key === 'unit') {
      if (typeof value !== 'string' || !value.trim() || value.length > 250) fail(`Invalid ${key}`);
    } else if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail(`Invalid ${key}`);
  }
  return changes;
}

function amendmentPatch(row, requested) {
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
  return patch;
}

/** Meal-scoped, version-checked commands. All snapshots and replies commit with the ledger. */
export class MealFoodCommands {
  constructor({ nutritionItems, logger = {} }) { this.store = nutritionItems; this.logger = logger; }

  async execute(userId, input) {
    const { date, bucket, action, operationId, selectedIds, expectedVersions } = input;
    if (!operationPattern.test(operationId || '') || !isISODate(date) || !MEAL_BUCKETS.some(b => b.id === bucket)) fail('A valid operation ID, date and meal bucket are required');
    if (!Array.isArray(selectedIds) || selectedIds.some(id => typeof id !== 'string') || new Set(selectedIds).size !== selectedIds.length) fail('Explicit unique selected food IDs are required');
    if (!expectedVersions || typeof expectedVersions !== 'object' || Array.isArray(expectedVersions)) fail('Expected versions are required');
    if (!['group', 'groups', 'membership', 'ungroup', 'amend'].includes(action)) fail('Invalid meal action');
    return this.store.runOperation(userId, operationId, { operation: 'meal-command', ...input }, async () => {
      const rows = await this.store.findByDate(userId, date);
      const byId = new Map(rows.map(row => [idOf(row), row]));
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
        for (const row of rows.filter(row => row.parentId === idOf(parent))) { get(idOf(row)); update(row, { parentId: desired.has(idOf(row)) ? idOf(parent) : null }); }
        for (const row of selected) if (desired.has(idOf(row))) update(row, { parentId: idOf(parent) });
        if (!desired.size) deleteIds.push(idOf(parent));
        else update(parent, input.name === undefined ? {} : validateChanges({ name: input.name }));
      } else {
        selected.forEach(check);
        for (const [id, changes] of Object.entries(input.changes || {})) {
          if (!selectedIds.includes(id)) fail('Amendment exceeds selection');
          const row = get(id); requireFood(row); update(row, amendmentPatch(row, changes));
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
      }
      // Retire only headers made empty by reassignment; foods are never deleted here.
      const oldParents = new Set([...updates.values()].map(u => byId.get(u.id)?.parentId).filter(Boolean));
      for (const parentId of oldParents) {
        const parent = get(parentId); check(parent);
        const remaining = rows.some(row => {
          const changes = updates.get(idOf(row))?.changes;
          return (changes && Object.hasOwn(changes, 'parentId') ? changes.parentId : row.parentId) === parentId;
        }) || creates.some(row => row.parentId === parentId);
        if (!remaining && !deleteIds.includes(parentId)) deleteIds.push(parentId);
      }
      const undoToken = `meal-${uuidv5(`${userId}:${operationId}`, uuidv5.URL)}`;
      const result = await this.store.mutateEntries(userId, {
        updates: [...updates.values()].filter(u => !deleteIds.includes(u.id)), creates, deleteIds, allowFoodCreates: action === 'amend',
        audit: { id: undoToken, fingerprint: fingerprint(input), type: 'meal-command', date, bucket },
        resultMeta: { committed: true, date, bucket, undoToken },
        validate: ({ before, after }) => {
          for (const id of checked) {
            const raw = before.find(row => idOf(row) === id);
            if (!raw || (raw.version ?? 1) !== expectedVersions[id]) fail('This meal changed. Reload before saving.', 409);
          }
          this.validateGraph(after);
        },
      });
      this.logger.info?.('health.meal.command', { userId, action, operationId, affectedIds: result.affectedIds });
      return result;
    });
  }

  validateGraph(rows) {
    const byId = new Map(rows.map(row => [idOf(row), row]));
    for (const row of rows) if (row.parentId) {
      const parent = byId.get(row.parentId);
      if (!parent || parent.kind !== 'group' || parent.parentId || row.kind === 'group' || parent.date !== row.date || mealRowBucket(parent) !== mealRowBucket(row)) fail('Invalid group membership', 409);
    }
  }

  async undo(userId, { undoToken, operationId }) {
    if (!operationPattern.test(operationId || '') || typeof undoToken !== 'string' || !/^meal-[a-f0-9-]{36}$/.test(undoToken)) fail('Valid Undo token and operation ID are required');
    return this.store.runOperation(userId, operationId, { operation: 'meal-undo', undoToken }, async () => {
      const record = await this.store.getCleanupAudit(userId, undoToken);
      if (!record || record.type !== 'meal-command') fail('Undo not found', 404);
      const result = await this.store.mutateEntries(userId, { restoreAudit: undoToken,
        resultMeta: { committed: true, date: record.date, bucket: record.bucket, undoToken: null },
        validate: ({ after }) => this.validateGraph(after),
      });
      this.logger.info?.('health.meal.undo', { userId, operationId, affectedIds: result.affectedIds });
      return result;
    });
  }
}
