import './ds.scss';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`); // noon avoids DST edge shifts
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const labelFor = (iso, max) => {
  if (iso === max) return 'Today';
  if (max && iso === addDays(max, -1)) return 'Yesterday';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
};

const Arrow = ({ flip }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
    style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function DateStepper({ date, onChange, max }) {
  const atMax = max != null && date >= max;
  return (
    <div className="ds-datestepper">
      <button type="button" className="ds-datestepper__arrow" aria-label="Previous day"
        onClick={() => onChange(addDays(date, -1))}><Arrow /></button>
      <button type="button" className="ds-datestepper__label"
        onClick={() => { if (max && date !== max) onChange(max); }}>
        {labelFor(date, max)}
      </button>
      <button type="button" className="ds-datestepper__arrow" aria-label="Next day"
        disabled={atMax} onClick={() => onChange(addDays(date, 1))}><Arrow flip /></button>
    </div>
  );
}

export default DateStepper;
