// Read-time settlement (PRD F3.5/F3.6): rows are never mutated to auto-settle;
// age is computed at presentation. Absent `settled` = settled (legacy default).
export const AUTO_SETTLE_DAYS = 3;

const dayOf = (row) => (row?.createdAt || row?.date || '').slice(0, 10);

const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

export function effectiveSettled(row, todayISO) {
  if (row?.settled !== false) return true;
  const created = dayOf(row);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) return true;
  return daysBetween(created, todayISO) > AUTO_SETTLE_DAYS;
}

export function presentSettlement(row, todayISO) {
  if (row?.settled === true) return { settled: true, settledBy: row.settledBy ?? 'user' };
  if (effectiveSettled(row, todayISO)) {
    return { settled: true, settledBy: row?.settled === false ? 'auto' : null };
  }
  return { settled: false, settledBy: null };
}

export default { AUTO_SETTLE_DAYS, effectiveSettled, presentSettlement };
