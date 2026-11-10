import React from 'react';
import PropTypes from 'prop-types';
import "./PresenceGateNotice.scss";

/**
 * Cover shown over a show or a held video while the presence gate blocks it and
 * the fingerprint prompt is not up (dismissed / timed out). One large button
 * re-opens the existing admin unlock prompt — touch (pointerdown), Enter/Space
 * and a gamepad's A (which the kiosk maps to Enter) all reach it.
 */
export default function PresenceGateNotice({ onUnlock, onBack }) {
  const activate = (fn) => ({
    onPointerDown: (e) => { e.preventDefault(); fn?.(); },
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn?.(); } },
  });
  return (
    <div className="presence-gate-notice" role="dialog" aria-modal="true" aria-label="Grown-up needed" data-testid="presence-gate-notice">
      <strong>Grown-up needed</strong>
      <p>Nobody who can supervise is home. A grown-up's fingerprint unlocks this.</p>
      <div className="presence-gate-notice__actions">
        <button type="button" className="presence-gate-notice__btn" autoFocus {...activate(onUnlock)}>Unlock</button>
        {onBack ? <button type="button" className="presence-gate-notice__btn presence-gate-notice__btn--secondary" {...activate(onBack)}>Back</button> : null}
      </div>
    </div>
  );
}

PresenceGateNotice.propTypes = {
  onUnlock: PropTypes.func.isRequired,
  onBack: PropTypes.func,
};
