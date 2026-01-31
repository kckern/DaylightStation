import React from 'react';
import PropTypes from 'prop-types';

/**
 * BlackoutScreen - App visual for audio-only mode
 * Renders a black screen with optional message from config.
 */
export function BlackoutScreen({ config = {} }) {
  const { message, showMessage = false } = config;

  return (
    <div
      data-track="visual"
      data-visual-type="blackout"
      className="blackout-screen"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {showMessage && message && (
        <p
          style={{
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '1.5rem',
            fontWeight: 300,
            textAlign: 'center',
            padding: '2rem'
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}

BlackoutScreen.propTypes = {
  config: PropTypes.shape({
    message: PropTypes.string,
    showMessage: PropTypes.bool
  })
};

export default BlackoutScreen;
