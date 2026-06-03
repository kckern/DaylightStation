import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import './CycleEventToast.scss';

// Default visible duration before the toast auto-dismisses.
export const CYCLE_TOAST_DURATION_MS = 4000;
// Fade/slide-out duration — keep in sync with CycleEventToast.scss.
export const CYCLE_TOAST_EXIT_MS = 280;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'cycle-event-toast' });
  return _logger;
}

/**
 * Single-slot, self-dismissing officiating-event banner for the cycle race
 * screen — announces a DNF or false-start penalty in plain language so the
 * acronyms on the chart and results board are never unexplained. Non-blocking:
 * it never pauses the race. The parent feeds the current toast (or null) and a
 * new `toast.id` restarts the countdown; on completion it calls onDone.
 */
export default function CycleEventToast({ toast, onDone, durationMs = CYCLE_TOAST_DURATION_MS }) {
  const [exiting, setExiting] = useState(false);
  const id = toast?.id ?? null;
  const timersRef = useRef({ hide: null, done: null });

  useEffect(() => {
    if (id == null) return undefined;
    setExiting(false);
    logger().info('cycle_game.event_toast.shown', { id, variant: toast?.variant });
    timersRef.current.hide = setTimeout(() => setExiting(true), durationMs);
    timersRef.current.done = setTimeout(() => {
      logger().debug('cycle_game.event_toast.dismissed', { id, reason: 'timeout' });
      if (typeof onDone === 'function') onDone(id);
    }, durationMs + CYCLE_TOAST_EXIT_MS);
    return () => {
      clearTimeout(timersRef.current.hide);
      clearTimeout(timersRef.current.done);
    };
    // Keyed on id only: ids are monotonic, so the same id never reappears with a
    // different callback/duration — no stale-closure risk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleDismiss = useCallback(() => {
    if (id == null) return;
    clearTimeout(timersRef.current.hide);
    clearTimeout(timersRef.current.done);
    setExiting(true);
    timersRef.current.done = setTimeout(() => {
      logger().debug('cycle_game.event_toast.dismissed', { id, reason: 'tap' });
      if (typeof onDone === 'function') onDone(id);
    }, CYCLE_TOAST_EXIT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onDone]);

  const className = useMemo(() => [
    'cycle-event-toast',
    `cycle-event-toast--${toast?.variant || 'info'}`,
    exiting ? 'cycle-event-toast--exiting' : 'cycle-event-toast--entered',
  ].join(' '), [toast?.variant, exiting]);

  if (!toast) return null;

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      data-testid="cycle-event-toast"
      data-variant={toast.variant}
      onClick={handleDismiss}
    >
      <div className="cycle-event-toast__body">
        {toast.icon ? <div className="cycle-event-toast__icon" aria-hidden="true">{toast.icon}</div> : null}
        <div className="cycle-event-toast__text">
          <div className="cycle-event-toast__title">{toast.title}</div>
          {toast.subtitle ? <div className="cycle-event-toast__subtitle">{toast.subtitle}</div> : null}
        </div>
      </div>
      <div className="cycle-event-toast__countdown">
        {/* key forces a remount per toast → restarts the CSS countdown animation */}
        <div
          key={id}
          className="cycle-event-toast__countdown-bar"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </div>
    </div>
  );
}

CycleEventToast.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.number,
    variant: PropTypes.oneOf(['dnf', 'penalty', 'info']),
    icon: PropTypes.node,
    title: PropTypes.node,
    subtitle: PropTypes.node,
  }),
  onDone: PropTypes.func,
  durationMs: PropTypes.number,
};
