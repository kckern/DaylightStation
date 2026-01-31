import React from 'react';
import PropTypes from 'prop-types';

/**
 * Screensaver - App visual placeholder for animated UI screensaver
 * Currently a stub that renders placeholder text.
 * Future: animated patterns, floating elements, etc.
 */
export function Screensaver({ config = {} }) {
  const { type = 'default' } = config;

  return (
    <div
      data-track="visual"
      data-visual-type="screensaver"
      className="screensaver"
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
      <div
        style={{
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '2rem',
          fontWeight: 300,
          textAlign: 'center'
        }}
      >
        Screensaver
        {type !== 'default' && (
          <div style={{ fontSize: '1rem', marginTop: '0.5rem' }}>
            Type: {type}
          </div>
        )}
      </div>
    </div>
  );
}

Screensaver.propTypes = {
  config: PropTypes.shape({
    type: PropTypes.string
  })
};

export default Screensaver;
