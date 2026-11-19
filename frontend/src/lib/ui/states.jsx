//
// The Loading / Error / Empty triad — the only way DS apps render async
// states. ErrorState REQUIRES a retry action: a dead-end error screen is a
// spec violation (anti-slop Tier 2), so its absence throws loudly.
import { Button } from './Button.jsx';
import Skeleton from './Skeleton.jsx';
import './ds.scss';

/** Shared root/typography for async states, including domain unavailable/partial notices. */
export function StateMessage({ state = 'empty', title, detail, icon, children, className = '', ...props }) {
  return <div {...props} className={`ds-state ds-state--${state} ${className}`.trim()}>
    {icon}
    {title != null && <p className="ds-state__title">{title}</p>}
    {detail != null && <p className="ds-state__detail">{detail}</p>}
    {children}
  </div>;
}

export function LoadingState({ label = 'content', rows = 3, children, className = '', ...props }) {
  return (
    <StateMessage {...props} state="loading" className={className} aria-busy="true" aria-label={`Loading ${label}`}>
      {children ?? Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={20} width={`${90 - i * 15}%`} />
      ))}
    </StateMessage>
  );
}

export function ErrorState({ error, onRetry, label = 'This section' }) {
  if (typeof onRetry !== 'function') {
    throw new Error('ErrorState requires onRetry — errors must offer a next step');
  }
  return (
    <StateMessage state="error" role="alert" title={`${label} failed to load`} detail={error?.message || 'Unknown error'}>
      <Button density="compact" variant="secondary" onClick={onRetry}>Retry</Button>
    </StateMessage>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <StateMessage state="empty" title={title} detail={hint || undefined}>
      {action ? (
        <Button density="compact" variant="secondary" onClick={action.onClick}>{action.label}</Button>
      ) : null}
    </StateMessage>
  );
}
