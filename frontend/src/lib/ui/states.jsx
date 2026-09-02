//
// The Loading / Error / Empty triad — the only way DS apps render async
// states. ErrorState REQUIRES a retry action: a dead-end error screen is a
// spec violation (anti-slop Tier 2), so its absence throws loudly.
import { Button } from '@mantine/core';
import Skeleton from './Skeleton.jsx';
import './ds.scss';

export function LoadingState({ label = 'content', rows = 3 }) {
  return (
    <div className="ds-state ds-state--loading" aria-busy="true" aria-label={`Loading ${label}`}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={20} width={`${90 - i * 15}%`} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry, label = 'This section' }) {
  if (typeof onRetry !== 'function') {
    throw new Error('ErrorState requires onRetry — errors must offer a next step');
  }
  return (
    <div className="ds-state ds-state--error" role="alert">
      <p className="ds-state__title">{label} failed to load</p>
      <p className="ds-state__detail">{error?.message || 'Unknown error'}</p>
      <Button size="xs" variant="light" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="ds-state ds-state--empty">
      <p className="ds-state__title">{title}</p>
      {hint ? <p className="ds-state__detail">{hint}</p> : null}
      {action ? (
        <Button size="xs" variant="light" onClick={action.onClick}>{action.label}</Button>
      ) : null}
    </div>
  );
}
