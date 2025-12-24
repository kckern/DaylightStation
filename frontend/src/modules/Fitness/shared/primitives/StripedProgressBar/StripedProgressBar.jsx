import React from 'react';
import PropTypes from 'prop-types';
import './StripedProgressBar.scss';

/**
 * StripedProgressBar - Animated striped progress bar with zone colors
 * 
 * Extracted from FitnessGovernance.jsx for reuse across shell and apps.
 */
const StripedProgressBar = ({
  value = 0,
  max = 100,
  color = 'gray',
  speed = 2,
  direction = 'left',
  height = 8,
  animated = true,
  showValue = false,
  className,
  style,
  ...props
}) => {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  
  const combinedClassName = [
    'striped-progress-bar',
    `striped-progress-bar--${color}`,
    `striped-progress-bar--${direction}`,
    animated ? 'striped-progress-bar--animated' : '',
    className
  ].filter(Boolean).join(' ');

  const barStyle = {
    '--stripe-speed': `${speed}s`,
    '--bar-height': typeof height === 'number' ? `${height}px` : height,
    ...style
  };

  return (
    <div className={combinedClassName} style={barStyle} {...props}>
      <div className="striped-progress-bar__track">
        <div 
          className="striped-progress-bar__fill"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
      {showValue && (
        <span className="striped-progress-bar__value">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
};

StripedProgressBar.propTypes = {
  /** Current progress value */
  value: PropTypes.number,
  /** Maximum value */
  max: PropTypes.number,
  /** Zone color: 'gray' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' */
  color: PropTypes.oneOf(['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'rest', 'cool', 'active', 'warm', 'hot', 'fire']),
  /** Animation speed in seconds */
  speed: PropTypes.number,
  /** Stripe animation direction */
  direction: PropTypes.oneOf(['left', 'right']),
  /** Bar height in px or CSS value */
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  /** Enable stripe animation */
  animated: PropTypes.bool,
  /** Show percentage value */
  showValue: PropTypes.bool,
  /** Additional CSS class */
  className: PropTypes.string,
  /** Additional inline styles */
  style: PropTypes.object
};

export default StripedProgressBar;
