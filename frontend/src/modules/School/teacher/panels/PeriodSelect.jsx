/**
 * PeriodSelect — pick the period the Records tab reads; defaults to the
 * current period (startsAt <= now < endsAt). Unlike the student panel's
 * resolver (null between terms — it shows standings only DURING a term),
 * this falls back to the most recent started period: a records surface
 * between terms should open on what just ended.
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
  if (hit) return hit.periodId;
  // Between terms: the most recent period that has STARTED — a records view
  // should default to what just ended, never to a pre-configured future term.
  const started = periods
    .filter((p) => Date.parse(p.startsAt) <= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return started.at(-1)?.periodId ?? periods[0]?.periodId ?? null;
}
