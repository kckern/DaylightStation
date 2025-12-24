import React from 'react';
import PropTypes from 'prop-types';
import './ProgressRing.scss';

const ProgressRing = ({
  value = 0,
  max = 100,
  size = 48,
  strokeWidth = 4,
  color,
  trackColor = 'rgba(255,255,255,0.1)',
  animated = true,
  children,
  className,
  ...props
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const offset = circumference - (percentage / 100) * circumference;

  const ringColor = color || 'var(--app-action-primary)';

  return (
    <div 
      className={`app-progress-ring ${className || ''}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      {...props}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="app-progress-ring__svg"
      >
        <circle
          className="app-progress-ring__track"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className={`app-progress-ring__fill ${animated ? 'app-progress-ring__fill--animated' : ''}`}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{
            strokeDasharray: `${circumference} ${circumference}`,
            strokeDashoffset: offset
          }}
        />
      </svg>
      {children && (
        <div className="app-progress-ring__content">
          {children}
        </div>
      )}
    </div>
  );
};

ProgressRing.propTypes = {
  value: PropTypes.number,
  max: PropTypes.number,
  size: PropTypes.number,
  strokeWidth: PropTypes.number,
  color: PropTypes.string,
  trackColor: PropTypes.string,
  animated: PropTypes.bool,
  children: PropTypes.node,
  className: PropTypes.string
};

export default ProgressRing;
