// Read-time presentation with an injected instant for exact review deadlines.
// Legacy date-only rows retain their original display rule.
export const AUTO_SETTLE_DAYS = 3;
import { reviewExpired } from '#shared/contracts/nutrition/reviewLifecycle.mjs';

const dayOf = (row) => (row?.createdAt || row?.date || '').slice(0, 10);

const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

export function effectiveSettled(row, todayISO, now = null) {
  if (row?.review) return row.settled === true || row.review.state !== 'provisional'
    || (now !== null ? reviewExpired(row, now) : todayISO?.length > 10 ? reviewExpired(row, todayISO) : false);
  if (row?.settled !== false) return true;
  const created = dayOf(row);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) return true;
  return daysBetween(created, todayISO) > AUTO_SETTLE_DAYS;
}

export function presentSettlement(row, todayISO, now = null) {
  if (row?.settled === true) return { settled: true, settledBy: row.settledBy ?? 'user' };
  if (effectiveSettled(row, todayISO, now)) {
    return { settled: true, settledBy: row?.settled === false ? 'auto' : null };
  }
  return { settled: false, settledBy: null };
}

export default { AUTO_SETTLE_DAYS, effectiveSettled, presentSettlement };
