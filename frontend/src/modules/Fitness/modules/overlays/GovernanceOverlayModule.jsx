import React from 'react';
import PropTypes from 'prop-types';
import GovernanceStateOverlayImpl from '../../FitnessPlayerOverlay/GovernanceStateOverlay.jsx';

/**
 * GovernanceOverlayModule - Wrapper for governance state overlay
 * 
 * Displays the HR governance status overlays including:
 * - Warning countdown bar
 * - Locked state with requirements
 * - User chips showing progress
 */
const GovernanceOverlayModule = ({
  visible = true,
  overlay,
  ...props
}) => {
  // Don't render if not visible or no overlay data
  if (!visible || !overlay?.show) {
    return null;
  }

  return (
    <GovernanceStateOverlayImpl
      overlay={overlay}
      {...props}
    />
  );
};

GovernanceOverlayModule.propTypes = {
  /** Whether to render the overlay */
  visible: PropTypes.bool,
  /** Overlay state from useGovernanceOverlay hook */
  overlay: PropTypes.shape({
    show: PropTypes.bool,
    status: PropTypes.string,
    category: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.array,
    requirements: PropTypes.array,
    highlightUsers: PropTypes.array,
    countdown: PropTypes.number,
    countdownTotal: PropTypes.number
  })
};

export default GovernanceOverlayModule;
