import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useChallengeOverlayPosition } from './useChallengeOverlayPosition.js';
import './ChallengeOverlayDeck.scss';

/**
 * ChallengeOverlayDeck — single positioned wrapper for the challenge-overlay
 * slot. Owns the shared top/middle/bottom position; child overlays
 * (ChallengeOverlay, CycleChallengeOverlay) render inside as
 * "dumb" presentational nodes. Tap-to-cycle and keyboard activation are
 * handled here once for the whole deck.
 */
export const ChallengeOverlayDeck = ({ children }) => {
  const { position, cyclePosition } = useChallengeOverlayPosition();

  const handleClick = useCallback((event) => {
    event.stopPropagation();
    cyclePosition();
  }, [cyclePosition]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      cyclePosition();
    }
  }, [cyclePosition]);

  return (
    <div
      className={`challenge-overlay-deck challenge-overlay-deck--pos-${position}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Challenge overlay deck — positioned ${position}. Tap to move.`}
    >
      {children}
    </div>
  );
};

ChallengeOverlayDeck.propTypes = {
  children: PropTypes.node
};

export default ChallengeOverlayDeck;
