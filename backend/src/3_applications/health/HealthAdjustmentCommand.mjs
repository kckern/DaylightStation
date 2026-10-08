import { projectFoodAdjustment } from '#shared/contracts/health/foodAdjustment.mjs';
import { foodGrams, NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { nowTs24 } from '#system/utils/time.mjs';

const COMMAND_FIELDS = new Set(['adjustment', 'restoreAdjustment', 'expectedVersion', 'expectedVersions', 'expectedDensityRevision']);
const ADJUSTMENT_FIELDS = new Set(['portion', 'protein', 'carbs', 'fat', 'calories', 'density']);
const RESTORE_FIELDS = new Set(['grams', 'amount', 'unit', ...NUTRIENT_KEYS]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validVersion = value => Number.isSafeInteger(value) && value > 0;
const entryId = row => row.uuid ?? row.id;
const sameIds = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const invalid = message => Object.assign(new Error(message), { status: 400 });
const conflict = () => Object.assign(new Error('This group changed. Reload it before saving.'), { status: 409, code: 'VERSION_CONFLICT' });

/** New commands are exclusive; the legacy update whitelist remains unchanged. */
export function validateAdjustmentCommand(changes) {
  const adjustment = Object.hasOwn(changes, 'adjustment');
  const restore = Object.hasOwn(changes, 'restoreAdjustment');
  if (!adjustment && !restore) return false;
  if (adjustment === restore || Object.keys(changes).some(key => !COMMAND_FIELDS.has(key))) {
    throw invalid('Send exactly one adjustment or restore command without other update fields');
  }
  if (!validVersion(changes.expectedVersion) || !record(changes.expectedVersions)
    || !Object.keys(changes.expectedVersions).length || !Object.values(changes.expectedVersions).every(validVersion)) {
    throw invalid('Expected entry and complete scope versions are required');
  }
  if (adjustment) {
    const request = changes.adjustment;
    if (!record(request) || Object.keys(request).length !== 2 || !ADJUSTMENT_FIELDS.has(request.field)
      || typeof request.value !== 'number' || !Number.isFinite(request.value) || request.value < 0) {
      throw invalid('Adjustment requires a supported field and a finite non-negative value');
    }
    if (['calories', 'density'].includes(request.field)
      && (typeof changes.expectedDensityRevision !== 'string' || !changes.expectedDensityRevision)) {
      throw invalid('Expected density configuration revision is required');
    }
  } else {
    const patches = changes.restoreAdjustment;
    if (!Array.isArray(patches) || !patches.length) throw invalid('Restore requires the complete scope');
    for (const patch of patches) {
      if (!record(patch) || Object.keys(patch).length !== 2 || typeof patch.id !== 'string' || !patch.id || !record(patch.changes)) {
        throw invalid('Restore requires entry IDs and numeric changes');
      }
      for (const [key, value] of Object.entries(patch.changes)) {
        const valid = value === null || (key === 'unit' ? typeof value === 'string' && !!value.trim()
          : typeof value === 'number' && Number.isFinite(value) && (key === 'grams' ? value > 0 : value >= 0));
        if (!RESTORE_FIELDS.has(key) || !valid) throw invalid(`Invalid restore field: ${key}`);
      }
    }
    const ids = patches.map(patch => patch.id);
    if (new Set(ids).size !== ids.length || !sameIds(ids, Object.keys(changes.expectedVersions))) {
      throw invalid('Restore IDs must match the complete expected scope exactly once');
    }
  }
  return true;
}

/** Build patches from the displayed snapshot; the ledger checks every version
 * and membership before committing, so intervening changes reject all patches. */
export function prepareAdjustmentCommand(existing, children, changes, context) {
  const rootId = entryId(existing);
  const rows = [existing, ...children];
  const scope = rows.map(entryId);
  if (!Object.hasOwn(changes.expectedVersions, rootId) || changes.expectedVersions[rootId] !== changes.expectedVersion) {
    throw invalid('Expected root version must match its scope version');
  }
  if (!sameIds(scope, Object.keys(changes.expectedVersions))) throw conflict();
  if (rows.some(row => changes.expectedVersions[entryId(row)] !== (row.version ?? 1))) throw conflict();
  if (changes.adjustment && ['calories', 'density'].includes(changes.adjustment.field)
    && changes.expectedDensityRevision !== context.densityRevision) {
    throw Object.assign(new Error('Density configuration changed. Refresh context before saving.'), {
      status: 409, code: 'DENSITY_CONFIGURATION_CHANGED',
    });
  }
  let patches = changes.restoreAdjustment;
  if (!patches) {
    try {
      patches = projectFoodAdjustment({ ...existing, children }, changes.adjustment, context.densityLevels);
    } catch (error) {
      if (error instanceof RangeError) throw invalid(error.message);
      throw error;
    }
  }
  const patchById = new Map(patches.map(patch => [patch.id, patch.changes]));
  const updates = rows.map(row => {
    const patch = Object.fromEntries(Object.entries(patchById.get(entryId(row)) || {})
      .filter(([key, value]) => value !== (row[key] ?? null)));
    const corrected = Object.keys(patch).filter(key => NUTRIENT_KEYS.includes(key));
    const manualFields = Object.keys(patch).filter(key => RESTORE_FIELDS.has(key));
    if (manualFields.length) patch.manualFields = [...new Set([...(row.manualFields || []), ...manualFields])];
    if (corrected.length) {
      patch.nutrientProvenance = { ...row.nutrientProvenance };
      for (const key of corrected) {
        if (patch[key] === null) delete patch.nutrientProvenance[key];
        else patch.nutrientProvenance[key] = { source: 'user', grams: foodGrams({ ...row, ...patch }), at: nowTs24() };
      }
    }
    return { id: entryId(row), changes: patch, expectedVersion: changes.expectedVersions[entryId(row)] };
  });
  return { updates, validate: ({ before }) => {
    const current = before.filter(row => entryId(row) === rootId || (existing.kind === 'group'
      && row.parentId != null && [existing.id, existing.uuid].includes(row.parentId))).map(entryId);
    if (!sameIds(scope, current)) throw conflict();
  } };
}
