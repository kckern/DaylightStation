import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
const name = row => row.label || row.item || row.name;
const identity = row => row.uuid || row.id;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

/** Explicit incident repair only: operator supplies the exact dish, members and total.
 * No heuristic regrouping, portion changes, new IDs, or nutrition corrections.
 */
export function planGroupCaptureRepair(log, rows, { label, children, expectedCalories }) {
  assert(log?.status === 'accepted', 'Expected an accepted capture');
  const parents = log.items.filter(item => name(item) === label);
  assert(parents.length === 1, 'Expected exactly one named dish');
  const parent = parents[0];
  const members = log.items.filter(item => item !== parent);
  assert(JSON.stringify(members.map(name).sort()) === JSON.stringify([...children].sort()), 'Ingredient evidence does not match the requested repair');
  assert(NUTRIENT_KEYS.every(key => !parent[key]), 'The proposed parent has additive nutrition');
  assert(members.reduce((sum, item) => sum + item.calories, 0) === expectedCalories, 'Ingredient calories changed');
  const captureItems = log.items.map(item => {
    const group = item === parent;
    return { ...item, kind: group ? 'group' : 'item', parentId: group ? null : parent.id,
      ...(group || ['Ranch Dressing', 'Cream Sauce', 'White Fish'].includes(name(item)) ? { icon: 'default' } : {}) };
  });
  const updates = captureItems.map(item => {
    const matches = rows.filter(row => identity(row) === identity(item));
    assert(matches.length === 1, 'Missing or duplicate daily entry');
    const row = matches[0];
    assert(name(row) === name(item) && NUTRIENT_KEYS.every(key => (row[key] || 0) === (item[key] || 0)), 'Daily entry was edited; inspect it manually');
    const changes = { kind: item.kind, parentId: item.parentId, icon: item.icon };
    return { id: identity(row), expectedVersion: row.version ?? 1, changes };
  }).filter(update => {
    const row = rows.find(row => identity(row) === update.id);
    return Object.entries(update.changes).some(([key, value]) => (row[key] ?? null) !== (value ?? null));
  });
  return { capture: { ...log, items: captureItems }, updates, expectedCalories };
}
