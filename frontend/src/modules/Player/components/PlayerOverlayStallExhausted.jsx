import React from 'react';
import PropTypes from 'prop-types';
import './PlayerOverlayStallExhausted.scss';

/**
 * Sustained-stall banner. Shows after `useStallExhaustion` flips `exhausted=true`.
 * Gives the user explicit affordances when the silent recovery loop fails.
 */
export function PlayerOverlayStallExhausted({ exhausted, secondsStalled, onRestart, onDismiss }) {
  if (!exhausted) return null;
  return (
    <div className="stall-exhausted-overlay" role="alertdialog">
      <div className="stall-exhausted-overlay__inner">
        <h2 className="stall-exhausted-overlay__title">Playback stuck</h2>
        <p className="stall-exhausted-overlay__body">
          We've been recovering for {secondsStalled}s without making progress.
          The video source may be unable to play on this device.
        </p>
        <div className="stall-exhausted-overlay__actions">
          <button type="button" onClick={onRestart}>Restart playback</button>
          <button type="button" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

PlayerOverlayStallExhausted.propTypes = {
  exhausted: PropTypes.bool.isRequired,
  secondsStalled: PropTypes.number.isRequired,
  onRestart: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
};

export default PlayerOverlayStallExhausted;
