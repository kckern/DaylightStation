import './gameChrome.scss';

export function CountdownOverlay({ value, className = '' }) {
  if (value === null || value === undefined) return null;
  return <div className={`piano-game-countdown${className ? ` ${className}` : ''}`}>{value}</div>;
}

export function LifeMeter({ current, maximum, className = '', dangerAt = 0.25 }) {
  const total = Math.max(0, Math.floor(Number(maximum) || 0));
  const live = Math.max(0, Number(current) || 0);
  return (
    <div className={`piano-game-life${className ? ` ${className}` : ''}`} aria-label={`${Math.ceil(live)} of ${total} health`}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`piano-game-life__notch${index < Math.ceil(live) ? ' is-active' : ''}${
            index < Math.ceil(live) && live <= total * dangerAt ? ' is-danger' : ''
          }`}
        />
      ))}
    </div>
  );
}

export function ProgressMeter({ value, maximum = 100, className = '', label = null }) {
  const pct = maximum > 0 ? Math.min(100, Math.max(0, (Number(value) / Number(maximum)) * 100)) : 0;
  return (
    <div className={`piano-game-progress${className ? ` ${className}` : ''}`} aria-label={label ?? `${Math.round(pct)}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
