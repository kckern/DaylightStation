import { foodGrams } from '#shared/contracts/health/foodQuantity.mjs';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';

const identity = row => row.uuid || row.id;
const name = row => String(row.name || row.item || row.label || '').trim().toLowerCase();
const samePortion = (row, evidence) => name(row) === name(evidence)
  && ['calories', 'protein', 'carbs', 'fat'].every(key => typeof row[key] === 'number'
    && Number.isFinite(row[key]) && row[key] === evidence[key]);

/** Pure, conservative migration: never alter nutrition or infer grams from volume. */
export function planNutritionRepair(rows, captureItems = []) {
  const evidenceById = new Map();
  for (const item of captureItems) {
    if (!identity(item)) continue;
    const entries = evidenceById.get(identity(item)) || [];
    entries.push(item); evidenceById.set(identity(item), entries);
  }
  const updates = [], unresolved = [];
  const seen = new Set();
  for (const row of rows) {
    const id = identity(row);
    if (!id || seen.has(id)) { unresolved.push({ id: id || null, reason: 'missing-or-duplicate-entry-id' }); continue; }
    seen.add(id);
    if (!isISODate(row.date)) { unresolved.push({ id, reason: 'invalid-or-missing-date' }); continue; }
    let grams = foodGrams(row);
    let evidence = grams === null ? 'unknown-mass' : Object.hasOwn(row, 'grams') ? 'explicit-mass' : 'gram-unit-quantity';
    // A capture's mass only applies to an unchanged nutrient/name snapshot.
    // Never borrow the original weight after a human changed the portion.
    if (grams === null && (row.version ?? 1) === 1 && row.kind !== 'group') {
      // Old parsers fabricated grams from serving/cup defaults. A stored
      // `grams` alone is not proof of what the source actually supplied.
      const candidates = (evidenceById.get(id) || []).filter(item => samePortion(row, item)
        && foodGrams(item.originalQuantity) !== null).map(item => foodGrams(item.originalQuantity));
      const unique = [...new Set(candidates)];
      if (unique.length === 1) { grams = unique[0]; evidence = 'matching-capture-id-and-nutrient-snapshot'; }
      if (unique.length > 1) evidence = 'conflicting-capture-masses';
    }
    if (grams === null && row.kind !== 'group') unresolved.push({ id, reason: evidence });
    const changes = { schemaVersion: 2, grams, unit: 'g', amount: grams,
      originalQuantity: row.originalQuantity ?? { amount: row.amount ?? null, unit: row.unit ?? null } };
    if (Object.entries(changes).some(([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value))) {
      updates.push({ id, expectedVersion: row.version ?? 1, changes, evidence });
    }
  }
  return { schemaVersion: 1, rowCount: rows.length, updates, unresolved };
}
