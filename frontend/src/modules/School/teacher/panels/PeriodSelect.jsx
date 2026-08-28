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

