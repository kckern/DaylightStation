import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import FingerprintIcon from '@/modules/Fitness/widgets/FingerprintManager/FingerprintIcon.jsx';
import { DaylightImagePath } from '@/lib/api.mjs';
import './UnlockPrompt.scss';

// "Access denied" avatar shown when a fingerprint isn't recognized — the Sonic
// "no-no-no" finger wag, rendered as a circular avatar in the denied state. It's
// an image, so it's served by the static image route (/api/v1/static/img/...),
// which sets the correct image/* content-type — NOT the AV media streamer, which
// serves octet-stream + nosniff and so won't render in an <img>.
const DENIED_AVATAR = DaylightImagePath('fitness/accessdenied.gif');

/**
 * Default auto-dismiss timeout. The garage reader round-trip is ~15s; this is a
 * generous safety net so a forgotten prompt closes itself if no finger lands.
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Per-state copy. `idle` is treated like the scanning prompt: the overlay is a
 * waiting affordance, and a fresh request transitions to 'scanning' almost
 * immediately, so showing the "place finger" prompt avoids an empty flash.
 */
const STATE_COPY = {
  idle: { title: 'Place finger to unlock', cancelLabel: 'Cancel', waiting: true },
  scanning: { title: 'Place finger to unlock', cancelLabel: 'Cancel', waiting: true },
  granted: { title: 'Access Granted', cancelLabel: 'Close', waiting: false },
  denied: { title: 'Not recognized', cancelLabel: 'Close', waiting: false },
  // Recognized fingerprint, but the person isn't permitted for this lock.
  unauthorized: { title: 'Not allowed', cancelLabel: 'Close', waiting: false },
};

// Generic avatar shown if the recognized user has no per-user image on file.
const FALLBACK_AVATAR = '/media/static/img/users/user';

/**
 * Presentational fingerprint-unlock overlay. Does NOT own the useUnlock hook —
 * parent components drive the request and pass `state`/`lockLabel` down, plus an
 * `onCancel` to dismiss. Built for the garage touchscreen (Firefox kiosk):
 * pointerdown-first for low-latency taps, with keyboard fallbacks.
 *
 * @param {object}   props
 * @param {boolean}  props.open       Whether the overlay is visible.
 * @param {'idle'|'scanning'|'granted'|'denied'} props.state  Scan state.
 * @param {string}   [props.lockLabel] Human-readable lock name (e.g. "Dance Party").
 * @param {() => void} props.onCancel  Called on cancel/close/escape/timeout.
 * @param {number}   [props.timeoutMs] Auto-dismiss timeout while waiting.
 * @param {{ name?: string, avatarSrc?: string }} [props.unlockedUser]  Recognized
 *   person, shown on the success (granted) screen while the chime plays.
 */
export default function UnlockPrompt({ open, state, lockLabel, onCancel, timeoutMs = DEFAULT_TIMEOUT_MS, unlockedUser }) {
  const logger = useMemo(() => getLogger().child({ component: 'unlock-prompt' }), []);

  // Keep the latest onCancel without re-arming the timeout / re-binding listeners.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const copy = STATE_COPY[state] || STATE_COPY.scanning;
  const waiting = copy.waiting;

  // Auto-dismiss: arm a timer only while open AND waiting (idle/scanning).
  // Clears on unmount, when open goes false, when state leaves the waiting set,
  // or when timeoutMs changes — all via the effect dependency list.
  useEffect(() => {
    if (!open || !waiting) return undefined;
    logger.debug('unlock_prompt.timeout_armed', { state, timeoutMs });
    const timer = setTimeout(() => {
      logger.info('unlock_prompt.timeout', { lock: lockLabel, state });
      onCancelRef.current?.();
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [open, waiting, timeoutMs, state, lockLabel, logger]);

  // Escape-to-cancel for accessibility (kiosk keyboards / dev).
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        logger.debug('unlock_prompt.escape');
        onCancelRef.current?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, logger]);

  if (!open) return null;

  const handleCancel = () => {
    logger.info('unlock_prompt.cancel', { lock: lockLabel, state });
    onCancelRef.current?.();
  };

  // Enter/Space keyboard activation (pointerdown handles taps).
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleCancel();
    }
  };

  const isGranted = state === 'granted';
  // Recognized fingerprint, but the person isn't permitted for this lock. Show
  // who it was (avatar + name) so it reads as "we know you, you're just not
  // allowed here" — distinct from an unrecognized finger.
  const isUnauthorized = state === 'unauthorized';
  const showAvatar = isGranted || (isUnauthorized && !!unlockedUser);

  return (
    <div className={`unlock-prompt unlock-prompt--${state}`} role="dialog" aria-modal="true" aria-label="Fingerprint unlock">
      <div className="unlock-prompt__backdrop" aria-hidden="true" />
      <div className="unlock-prompt__card">
        {showAvatar ? (
          <div className={`unlock-prompt__avatar${isUnauthorized ? ' unlock-prompt__avatar--blocked' : ''}`} aria-hidden="true">
            <img
              className="unlock-prompt__avatar-img"
              src={unlockedUser?.avatarSrc || FALLBACK_AVATAR}
              alt=""
              onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
            />
            <span className="unlock-prompt__avatar-check" aria-hidden="true">{isGranted ? '✓' : '✕'}</span>
          </div>
        ) : (
          <div className={`unlock-prompt__glyph unlock-prompt__glyph--${state}`} aria-hidden="true">
            {state === 'denied' ? (
              // "Access denied": rejection gif filling the glyph box, inheriting the
              // red drop-shadow glow from &--denied.
              <img className="unlock-prompt__denied-avatar" src={DENIED_AVATAR} alt="" />
            ) : (
              <FingerprintIcon size="100%" />
            )}
          </div>
        )}

        <div className="unlock-prompt__title">{copy.title}</div>
        {(isGranted || isUnauthorized) && unlockedUser?.name ? (
          <div className="unlock-prompt__user-name">{unlockedUser.name}</div>
        ) : null}
        {waiting && lockLabel ? (
          <div className="unlock-prompt__lock-label">{lockLabel}</div>
        ) : null}

        <button
          type="button"
          className="unlock-prompt__cancel"
          onPointerDown={handleCancel}
          onKeyDown={handleKeyDown}
        >
          {copy.cancelLabel}
        </button>
      </div>
    </div>
  );
}

UnlockPrompt.propTypes = {
  open: PropTypes.bool,
  state: PropTypes.oneOf(['idle', 'scanning', 'granted', 'denied', 'unauthorized']),
  lockLabel: PropTypes.string,
  onCancel: PropTypes.func.isRequired,
  timeoutMs: PropTypes.number,
  unlockedUser: PropTypes.shape({
    userId: PropTypes.string,
    name: PropTypes.string,
    avatarSrc: PropTypes.string,
  }),
};
