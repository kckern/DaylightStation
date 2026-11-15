/** The Monday calendar address containing an instant in the series timezone. */
export function weekOf({ instant, timezone }) {
  const date = new Date(instant);
  if (!Number.isFinite(date.valueOf())) throw new RangeError('Invalid instant');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const local = new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)));
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  return local.toISOString().slice(0, 10);
}
