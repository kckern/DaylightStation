import { useDisplayClock } from '@/lib/hooks/useDisplayClock.js';

const MAX_QUOTE = 60;
const quote = text => (text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1)}…` : text);

/**
 * Elapsed-time estimate only; completion is owned by the capture request.
 * `text` (a typed sentence being parsed) makes the row say what it is adding,
 * so the pending row reads as the food about to land there.
 */
export function CaptureProgress({ startedAt, estimateMs = 15000, label = 'Food analysis', text = null, active = true }) {
  const now = useDisplayClock(active, 250);
  const elapsed = Math.max(0, now - startedAt);
  const overdue = elapsed >= estimateMs;
  const value = Math.min(99, Math.round(elapsed / estimateMs * 100));
  const overdueMessage = text ? `Still adding “${quote(text)}”…` : 'Still analyzing…';
  return <div className="health-capture-progress" aria-busy="true">
    <span className="health-capture-progress__label">{text
      ? (overdue ? overdueMessage : `Adding “${quote(text)}”…`)
      : (overdue ? 'Still analyzing…' : 'Analyzing…')}</span>
    <div className={`health-capture-progress__track${overdue ? ' health-capture-progress__track--indefinite' : ''}`}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={overdue ? undefined : value} aria-valuetext={overdue ? overdueMessage : `About ${value}%`}
    ><span style={{ width: overdue ? '100%' : `${value}%` }} /></div>
  </div>;
}
