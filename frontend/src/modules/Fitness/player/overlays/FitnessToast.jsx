import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { DEFAULT_TOAST_DURATION_MS } from './fitnessToastSlot.js';
import './FitnessToast.scss';

// Fade + collapse exit duration. Keep in sync with FitnessToast.scss transition.
export const TOAST_EXIT_MS = 320;

/**
 * Ephemeral, centered, self-dismissing notification for the video view.
 * Single-slot: the parent passes the current toast (or null). A new `toast.id`
 * restarts the countdown + animation; on completion the toast fades/collapses
 * and calls onDone(id). Non-blocking — never pauses video or gates governance.
 */
export default function FitnessToast({ toast, onDone }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-toast' }), []);
  const [exiting, setExiting] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const id = toast?.id ?? null;
  const timersRef = useRef({ hide: null, done: null });

  useEffect(() => {
    if (id == null) return undefined;
    setExiting(false);
    setImgFailed(false);
    const durationMs = Number.isFinite(toast?.durationMs) ? toast.durationMs : DEFAULT_TOAST_DURATION_MS;
    logger.info('fitness.toast.shown', { id, variant: toast?.variant, durationMs });
    timersRef.current.hide = setTimeout(() => setExiting(true), durationMs);
    timersRef.current.done = setTimeout(() => {
      logger.info('fitness.toast.dismissed', { id, reason: 'timeout' });
      if (typeof onDone === 'function') onDone(id);
    }, durationMs + TOAST_EXIT_MS);
    return () => {
      clearTimeout(timersRef.current.hide);
      clearTimeout(timersRef.current.done);
    };
    // Intentionally keyed on `id` only. onDone/durationMs/variant are read from the
    // toast captured when this id last changed; ids are monotonic (see normalizeToast),
    // so the same id never reappears with a different callback/duration — no stale-closure risk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleDismiss = useCallback(() => {
    if (id == null) return;
    clearTimeout(timersRef.current.hide);
    clearTimeout(timersRef.current.done);
    setExiting(true);
    timersRef.current.done = setTimeout(() => {
      logger.info('fitness.toast.dismissed', { id, reason: 'tap' });
      if (typeof onDone === 'function') onDone(id);
    }, TOAST_EXIT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onDone]);

  if (!toast) return null;

  const { avatarUrl, icon, title, subtitle, variant = 'info', durationMs = DEFAULT_TOAST_DURATION_MS } = toast;
  const className = [
    'fitness-toast',
    `fitness-toast--${variant}`,
    exiting ? 'fitness-toast--exiting' : 'fitness-toast--entered',
  ].join(' ');

  return (
    <div className={className} role="status" aria-live="polite" onClick={handleDismiss}>
      <div className="fitness-toast__body">
        {avatarUrl && !imgFailed ? (
          <img
            className="fitness-toast__avatar"
            src={avatarUrl}
            alt=""
            onError={() => setImgFailed(true)}
          />
        ) : icon ? (
          <div className="fitness-toast__icon">{icon}</div>
        ) : null}
        <div className="fitness-toast__text">
          <div className="fitness-toast__title">{title}</div>
          {subtitle ? <div className="fitness-toast__subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <div className="fitness-toast__countdown">
        {/* key forces a DOM remount on each new toast → restarts the CSS countdown animation */}
        <div
          key={id}
          className="fitness-toast__countdown-bar"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </div>
    </div>
  );
}

FitnessToast.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.number,
    avatarUrl: PropTypes.string,
    icon: PropTypes.node,
    title: PropTypes.node,
    subtitle: PropTypes.node,
    variant: PropTypes.string,
    durationMs: PropTypes.number,
  }),
  onDone: PropTypes.func,
};
