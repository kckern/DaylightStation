import { isCountedRow, sumCounted } from '#shared/contracts/nutrition/countedRows.mjs';

/** Receipt read model. Accepted captures read ONLY the ledger; capture items are
 * evidence, not a second current-food store. Group rows are non-additive. */
export function nutritionReceipt(log, ledger, interaction = null) {
  const pending = log.status === 'pending';
  const rows = pending ? (log.items || []).map(row => ({ ...row,
    date: log.meal?.date, mealTime: log.meal?.time })) : ledger.filter(row =>
    (row.logId || row.log_uuid || row.logUuid) === log.id && isCountedRow(row));
  // Health Undo can restore ledger entries after a capture was marked deleted.
  // The restored ledger, not that old capture status, owns the current truth.
  const removed = !pending && !rows.some(row => row.kind !== 'group');
  const sections = [];
  if (!removed) for (const row of rows) {
    const date = row.date || log.meal?.date;
    const mealTime = Object.hasOwn(row, 'mealTime') ? row.mealTime : log.meal?.time;
    let section = sections.find(value => value.date === date && value.mealTime === mealTime);
    if (!section) { section = { date, mealTime, items: [] }; sections.push(section); }
    const parent = rows.find(value => row.parentId && [value.uuid, value.id].includes(row.parentId));
    section.items.push({ id: row.uuid || row.id, parentId: parent ? parent.uuid || parent.id : row.parentId || null,
      kind: row.kind || 'item', name: row.name || row.item || row.label || 'Unknown food',
      color: row.color || row.noom_color, grams: row.grams ?? null,
      amount: row.amount ?? null, unit: row.unit || null });
  }
  return { id: log.id, status: removed ? 'removed' : pending ? 'pending' : 'saved',
    sections, calories: removed ? 0 : sumCounted(rows, 'calories'),
    count: removed ? 0 : rows.filter(row => row.kind !== 'group').length,
    portionChoices: !removed && log.metadata?.source === 'upc',
    interaction: removed ? null : interaction };
}
