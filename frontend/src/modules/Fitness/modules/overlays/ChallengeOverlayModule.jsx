import React from 'react';
import PropTypes from 'prop-types';
import { ChallengeOverlay as ChallengeOverlayImpl, useChallengeOverlays } from '../../FitnessPlayerOverlay/ChallengeOverlay.jsx';

/**
 * ChallengeOverlayModule - Wrapper for challenge countdown overlay
 * 
 * Displays the challenge ring with countdown timer, zone requirements,
 * and success/failure animations.
 */
const ChallengeOverlayModule = ({
  visible = true,
  challenge,
  ...props
}) => {
  if (!visible) {
    return null;
  }

  return (
    <ChallengeOverlayImpl
      challenge={challenge}
      {...props}
    />
  );
};

ChallengeOverlayModule.propTypes = {
  /** Whether to render the overlay */
  visible: PropTypes.bool,
  /** Challenge state object */
  challenge: PropTypes.shape({
    id: PropTypes.string,
    status: PropTypes.string,
    zone: PropTypes.string,
    zoneLabel: PropTypes.string,
    remainingSeconds: PropTypes.number,
    totalSeconds: PropTypes.number,
    requiredCount: PropTypes.number,
    actualCount: PropTypes.number,
    metUsers: PropTypes.array,
    missingUsers: PropTypes.array
  })
};

// Re-export the hook for external use
export { useChallengeOverlays };

export default ChallengeOverlayModule;
