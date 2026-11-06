export default function ProgressMeter({ value, maximum = 100, label = null, className = '' }) {
  const pct = maximum > 0 ? Math.min(100, Math.max(0, (Number(value) / Number(maximum)) * 100)) : 0;
  return (
    <div className={`game-hud-progress${className ? ` ${className}` : ''}`} aria-label={label ?? `${Math.round(pct)}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
