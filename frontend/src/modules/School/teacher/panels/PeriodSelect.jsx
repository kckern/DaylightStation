/**
 * PeriodSelect — pick the period the Records tab reads; defaults to the
 * current period (startsAt <= now < endsAt), the same client-side resolution
 * the student panel uses.
 */
export default function PeriodSelect({ periods, value, onChange }) {
  if (!periods.length) return null;
  return (
    <select
      className="teacher-period-select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Period"
    >
      {periods.map((p) => (
        <option key={p.periodId} value={p.periodId}>{p.label ?? p.periodId}</option>
      ))}
    </select>
  );
}

export function currentPeriodId(periods, now = Date.now()) {
  const hit = periods.find((p) => Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt));
  return hit?.periodId ?? periods.at(-1)?.periodId ?? null;
}
