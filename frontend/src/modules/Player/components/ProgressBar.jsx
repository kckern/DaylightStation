import React from 'react';
import PropTypes from 'prop-types';

/**
 * Progress bar component for displaying media playback progress
 */
export function ProgressBar({ percent, onClick }) {
  return (
    <div
      className="progress-bar"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : {}}
    >
      <div className="progress" style={{ width: `${percent}%` }} />
    </div>
  );
}

ProgressBar.propTypes = {
  percent: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  onClick: PropTypes.func
};
