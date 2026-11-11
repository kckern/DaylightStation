import React from 'react';
import PropTypes from 'prop-types';
import "./PresenceGateNotice.scss";

// What the cover says for each blocking budget status. Every status names what
// is happening and what will move it forward — never a bare "waiting".
const COPY = {
  checking: {
    title: 'Checking playback allowance…',
    body: 'This usually takes a moment. A grown-up can unlock this video now.',
  },
  unavailable: {
    title: 'Playback allowance unavailable',
    body: 'The allowance could not be read; trying again. A grown-up can unlock this video.',
  },
  exhausted: {
    title: 'Unattended playback limit reached',
    body: 'A grown-up can join the workout to continue, or unlock this video with a fingerprint.',
  },
};

/**
 * Cover shown over a video the unattended playback budget is holding. Same
 * look and controls as PresenceGateNotice: "Unlock" asks for an admin
 * fingerprint (the presence gate's registerAdmin unlock), "Back" leaves.
 * Touch (pointerdown), Enter/Space and a gamepad's A all reach the buttons.
 */
export default function PlaybackBudgetNotice({ status, onUnlock, onBack }) {
  const copy = COPY[status] || COPY.checking;
  const activate = (fn) => ({
    onPointerDown: (e) => { e.preventDefault(); fn?.(); },
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn?.(); } },
  });
  return (
    <div className="presence-gate-notice playback-budget-overlay" role="status" aria-label={copy.title}
      data-testid="playback-budget-overlay" data-status={status || 'checking'}>
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
      <div className="presence-gate-notice__actions">
        {onUnlock ? (
          <button type="button" className="presence-gate-notice__btn" data-testid="playback-budget-unlock" {...activate(onUnlock)}>Unlock</button>
        ) : null}
        {onBack ? (
          <button type="button" className="presence-gate-notice__btn presence-gate-notice__btn--secondary" data-testid="playback-budget-back" {...activate(onBack)}>Back</button>
        ) : null}
      </div>
    </div>
  );
}

PlaybackBudgetNotice.propTypes = {
  status: PropTypes.string,
  onUnlock: PropTypes.func,
  onBack: PropTypes.func,
};
