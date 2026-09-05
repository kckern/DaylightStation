import { isISODate } from '#shared/contracts/health/isoDate.mjs';

export const CLEANUP_NUMBERS = ['amount', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
export const CLEANUP_FIELDS = ['name', 'label', 'icon', 'foodId', 'color', 'kind', 'parentId', 'date', 'mealTime', 'unit', ...CLEANUP_NUMBERS];
const fail = (message, code = 'CLEANUP_REVIEW_REQUIRED') => {
  throw Object.assign(new Error(message), { code, status: 409 });
};
export const entryKey = row => row.uuid || row.id;
export function cleanupDates(now, timezone) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const yesterday = new Date(today + 'T12:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return [today, yesterday.toISOString().slice(0, 10)];
}

/** Pure commit-time policy. Facts are supplied by trusted tools, never the model. */
export function validateCleanup({ before, after, updates, creates = [], evidence = [], now, timezone, userId, userDirected = false }) {
  const dates = cleanupDates(now, timezone);
  const byId = new Map(before.flatMap(row => [[row.uuid, row], [row.id, row]]));
  const seen = new Set();
  for (const { id, changes, expectedVersion } of updates) {
    const row = byId.get(id);
    if (!row || (row.userId && row.userId !== userId)) fail('Entry is unavailable', 'NOT_FOUND');
    if (seen.has(entryKey(row))) fail('Repeated food update');
    seen.add(entryKey(row));
    if (expectedVersion == null || expectedVersion !== (row.version ?? 1)) fail('Entry changed', 'VERSION_CONFLICT');
    if (!dates.includes(row.date) || (changes.date && !dates.includes(changes.date))) fail('Automatic cleanup only changes today and yesterday', 'CLEANUP_DATE_WINDOW');
    if (Object.keys(changes).some(key => !CLEANUP_FIELDS.includes(key))) fail('Unsupported cleanup field');
    for (const [field, value] of Object.entries(changes)) {
      if (JSON.stringify(value) === JSON.stringify(row[field])) continue;
      const aliases = ['label', 'name'].includes(field) ? ['label', 'name'] : [field];
      if (!userDirected && (row.settledBy === 'user' || aliases.some(key => row.manualFields?.includes(key)))) fail('Preserving your manual correction', 'CLEANUP_USER_PROTECTED');
      if (!userDirected && aliases.some(key => row.cleanupFields?.includes(key))) fail('This field was already cleaned; leave it for manual review', 'CLEANUP_ALREADY_REPAIRED');
      if (CLEANUP_NUMBERS.includes(field) && value !== null && (!Number.isFinite(value) || value < 0)) fail('Invalid nutrition or quantity');
      if (field === 'amount' && (!Number.isFinite(value) || value <= 0 || value > 10000)) fail('Invalid serving amount');
      if (['name', 'label', 'unit'].includes(field) && (typeof value !== 'string' || !value.trim() || value.length > (field === 'unit' ? 20 : 300))) fail('Invalid food label or unit');
      if (['amount', 'grams', 'unit', ...CLEANUP_NUMBERS.slice(2)].includes(field) && !userDirected) {
        const supported = evidence.some(source => ['product', 'label', 'capture'].includes(source.kind)
          && source.facts?.some(fact => fact.entryId === entryKey(row) && fact.field === field && fact.value === value));
        if (!supported) fail('Quantity and nutrition require serving-specific evidence');
      }
    }
    if ('date' in changes && !isISODate(changes.date)) fail('Invalid date');
    if ('mealTime' in changes && !['morning', 'afternoon', 'evening', 'night'].includes(changes.mealTime)) fail('Invalid meal');
    if ('kind' in changes && !['group', 'item'].includes(changes.kind)) fail('Invalid entry kind');
    if ('color' in changes && !['green', 'yellow', 'orange'].includes(changes.color)) fail('Invalid food category');
    // Converting a counted parent would discard consumption, not merely group it.
    if (changes.kind === 'group' && row.kind !== 'group' && CLEANUP_NUMBERS.slice(2).some(k => row[k] > 0)) fail('A calorie-bearing parent needs review before grouping');
  }
  for (const row of creates) {
    if (row.kind !== 'group' || !dates.includes(row.date) || CLEANUP_NUMBERS.slice(2).some(k => row[k] > 0)) fail('Only non-additive group headers may be created');
    if (!after.some(child => child.parentId && (child.parentId === row.id || child.parentId === row.uuid))) fail('New groups must contain existing food');
  }
  const index = new Map(after.flatMap(row => [[row.id, row], [row.uuid, row]]));
  const touched = new Set([...updates.flatMap(u => [byId.get(u.id).id, byId.get(u.id).uuid]), ...creates.flatMap(row => [row.id, row.uuid])].filter(Boolean));
  for (const row of after) {
    if (!touched.has(entryKey(row)) && !touched.has(row.parentId)) continue;
    if (row.kind === 'group' && CLEANUP_NUMBERS.slice(2).some(k => row[k] > 0)) fail('Group headers cannot contribute nutrition');
    if (!row.parentId) continue;
    const parent = index.get(row.parentId);
    if (!parent || parent.kind !== 'group' || parent.parentId || row.kind === 'group' || entryKey(row) === entryKey(parent)) fail('Invalid group relationship');
    if (parent.date !== row.date || parent.mealTime !== row.mealTime) fail('Group members must share a day and meal');
    const log = value => value.logUuid || value.log_uuid || value.logId;
    if (!log(parent) || log(parent) === 'MANUAL' || log(parent) !== log(row)) fail('Grouping across captures requires manual editing');
  }
  return true;
}
