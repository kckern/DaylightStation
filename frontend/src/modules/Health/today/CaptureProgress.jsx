import { useEffect, useState } from 'react';

/** Elapsed-time estimate only; completion is owned by the capture request. */
export function CaptureProgress({ startedAt, estimateMs = 15000, label = 'Food analysis' }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  const overdue = elapsed >= estimateMs;
  const value = Math.min(99, Math.round(elapsed / estimateMs * 100));
  return <div className="health-capture-progress" aria-busy="true">
    <span className="health-capture-progress__label">{overdue ? 'Still analyzing…' : 'Analyzing…'}</span>
    <div className={`health-capture-progress__track${overdue ? ' health-capture-progress__track--indefinite' : ''}`}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={overdue ? undefined : value} aria-valuetext={overdue ? 'Still analyzing' : `About ${value}%`}
    ><span style={{ width: overdue ? '100%' : `${value}%` }} /></div>
  </div>;
}
