import React from 'react';
import PropTypes from 'prop-types';
import FullscreenVitalsOverlayImpl from '../../FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx';

/**
 * FullscreenVitalsOverlayModule - Wrapper for fullscreen vitals display
 * 
 * Shows participant HR/vitals in fullscreen mode when video controls are hidden.
 */
const FullscreenVitalsOverlayModule = ({
  visible = false,
  ...props
}) => {
  if (!visible) {
    return null;
  }

  return (
    <FullscreenVitalsOverlayImpl
      visible={visible}
      {...props}
    />
  );
};

FullscreenVitalsOverlayModule.propTypes = {
  /** Whether to show the fullscreen vitals */
  visible: PropTypes.bool
};

export default FullscreenVitalsOverlayModule;
