import React, { useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import { formatCooldownHint } from './cycleSwapModalUtils.js';
import getLogger from '@/lib/logging/Logger.js';
import './CycleRiderSwapModal.scss';

/**
 * CycleRiderSwapModal (Task 24).
 *
 * Portal-based modal for confirming a cycle-rider swap. Triggered from
 * CycleChallengeOverlay when the user taps the rider avatar and the
 * challenge snapshot reports `swapAllowed === true`.
 *
 * The `eligibleUsers` list is pre-filtered by the governance engine — it
 * excludes the current rider and anyone still on cycle cooldown. The
 * (optional) `cycleCooldowns` map is accepted for safety so we can still
 * surface a hint if an unfiltered list is ever passed.
 *
 * Modal chrome (backdrop click + Escape key) closes without confirming;
 * `onConfirm(riderId)` fires when the user taps one of the rider tiles.
 */
/**
 * Build a default user resolver: id → { name, avatarUrl }.
 * Falls back to title-casing the id and the generic /static/img/users/{id}
 * route, which the backend's avatar API serves a placeholder for unknown
 * users.
 */
function defaultResolveUser(uid) {
  const name = (uid || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '?';
  return {
    name,
    avatarUrl: uid ? `/api/v1/static/img/users/${uid}` : '/api/v1/static/img/users/user'
  };
}

export default function CycleRiderSwapModal({
  isOpen,
  currentRider,
  eligibleUsers = [],
  cycleCooldowns = {},
  now,
  onConfirm,
  onClose,
  resolveUser
}) {
  const logger = useMemo(
    () => getLogger().child({ component: 'cycle-rider-swap-modal' }),
    []
  );

  const effectiveNow = typeof now === 'number' ? now : Date.now();
  const resolveUserFn = typeof resolveUser === 'function' ? resolveUser : defaultResolveUser;

  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) {
        logger.debug('dismiss', { reason: 'backdrop' });
        if (typeof onClose === 'function') onClose();
      }
    },
    [onClose, logger]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        logger.debug('dismiss', { reason: 'escape' });
        if (typeof onClose === 'function') onClose();
      }
    },
    [onClose, logger]
  );

  const handleConfirm = useCallback(
    (riderId) => {
      logger.info('confirm', { riderId, fromRider: currentRider?.id || null });
      if (typeof onConfirm === 'function') onConfirm(riderId);
    },
    [onConfirm, currentRider, logger]
  );

  const handleCloseClick = useCallback(() => {
    logger.debug('dismiss', { reason: 'close-button' });
    if (typeof onClose === 'function') onClose();
  }, [onClose, logger]);

  const handleCancelClick = useCallback(() => {
    logger.debug('dismiss', { reason: 'cancel-button' });
    if (typeof onClose === 'function') onClose();
  }, [onClose, logger]);

  useEffect(() => {
    if (!isOpen) return undefined;
    logger.info('open', {
      currentRiderId: currentRider?.id || null,
      eligibleCount: eligibleUsers.length
    });
    if (typeof document === 'undefined') return undefined;
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown, logger, currentRider, eligibleUsers.length]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const content = (
    <div
      className="cycle-swap-modal"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cycle-swap-title"
    >
      <div
        className="cycle-swap-modal__panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cycle-swap-modal__header">
          <h2 id="cycle-swap-title" className="cycle-swap-modal__title">
            Switch rider
          </h2>
          <button
            type="button"
            className="cycle-swap-modal__close"
            onClick={handleCloseClick}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {currentRider?.id || currentRider?.name ? (() => {
          const resolved = resolveUserFn(currentRider.id || currentRider.name);
          const displayName = currentRider.name || resolved.name;
          return (
            <div className="cycle-swap-modal__current">
              <img
                className="cycle-swap-modal__current-avatar"
                src={resolved.avatarUrl}
                alt=""
                onError={(e) => { e.currentTarget.src = '/api/v1/static/img/users/user'; }}
              />
              <span>Current: <strong>{displayName}</strong></span>
            </div>
          );
        })() : null}

        <div className="cycle-swap-modal__body">
          {eligibleUsers.length === 0 ? (
            <div className="cycle-swap-modal__empty">
              No other eligible riders available.
            </div>
          ) : (
            <ul className="cycle-swap-modal__list">
              {eligibleUsers.map((uid) => {
                const hint = formatCooldownHint(cycleCooldowns[uid], effectiveNow);
                const resolved = resolveUserFn(uid);
                const initial = (resolved.name?.[0] || uid?.[0] || '?').toUpperCase();
                return (
                  <li key={uid} className="cycle-swap-modal__item">
                    <button
                      type="button"
                      className="cycle-swap-modal__rider-btn"
                      onClick={() => handleConfirm(uid)}
                    >
                      <span className="cycle-swap-modal__rider-avatar-wrap">
                        <img
                          className="cycle-swap-modal__rider-avatar"
                          src={resolved.avatarUrl}
                          alt=""
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextSibling.style.display = 'flex';
                          }}
                        />
                        <span className="cycle-swap-modal__rider-initial" style={{ display: 'none' }}>
                          {initial}
                        </span>
                      </span>
                      <span className="cycle-swap-modal__rider-name">{resolved.name}</span>
                      {hint ? (
                        <span className="cycle-swap-modal__rider-hint">
                          {hint}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="cycle-swap-modal__footer">
          <button
            type="button"
            className="cycle-swap-modal__cancel"
            onClick={handleCancelClick}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}

CycleRiderSwapModal.propTypes = {
  isOpen: PropTypes.bool,
  currentRider: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string
  }),
  eligibleUsers: PropTypes.arrayOf(PropTypes.string),
  cycleCooldowns: PropTypes.object,
  now: PropTypes.number,
  onConfirm: PropTypes.func,
  onClose: PropTypes.func,
  resolveUser: PropTypes.func
};
