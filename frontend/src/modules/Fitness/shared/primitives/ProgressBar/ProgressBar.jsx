import React from 'react';
import PropTypes from 'prop-types';
import './ProgressBar.scss';

const ProgressBar = ({
  value = 0,
  max = 100,
  variant = 'default',
  segments,
  color,
  size = 'md',
  showLabel = false,
  labelFormat,
  animated = true,
  indeterminate = false,
  orientation = 'horizontal',
  className,
  ...props
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  const getZoneColor = (zone) => {
    switch (zone) {
      case 'fire': return 'var(--zone-fire)';
      case 'hot': return 'var(--zone-hot)';
      case 'warm': return 'var(--zone-warm)';
      case 'active': return 'var(--zone-active)';
      case 'cool': return 'var(--zone-cool)';
      default: return color || 'var(--app-action-primary)';
    }
  };

  const barStyle = {
    width: orientation === 'horizontal' ? `${percentage}%` : '100%',
    height: orientation === 'vertical' ? `${percentage}%` : '100%',
    backgroundColor: color === 'zone' ? undefined : color,
    transition: animated ? 'all 0.3s ease-out' : 'none'
  };

  const combinedClassName = [
    'app-progress-bar',
    `app-progress-bar--${variant}`,
    `app-progress-bar--${size}`,
    `app-progress-bar--${orientation}`,
    indeterminate ? 'app-progress-bar--indeterminate' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div 
      className={combinedClassName} 
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      {...props}
    >
      <div className="app-progress-bar__track">
        {variant === 'segmented' && segments ? (
          segments.map((seg, i) => (
            <div
              key={i}
              className="app-progress-bar__segment"
              style={{
                flex: seg.weight || 1,
                backgroundColor: seg.filled ? (seg.color || getZoneColor(seg.zone)) : 'transparent'
              }}
            />
          ))
        ) : (
          <div className="app-progress-bar__fill" style={barStyle} />
        )}
      </div>
      
      {showLabel && (
        <div className="app-progress-bar__label">
          {labelFormat ? labelFormat(value, max) : `${Math.round(percentage)}%`}
        </div>
      )}
    </div>
  );
};

ProgressBar.propTypes = {
  value: PropTypes.number,
  max: PropTypes.number,
  variant: PropTypes.oneOf(['default', 'striped', 'segmented', 'gradient']),
  segments: PropTypes.arrayOf(PropTypes.shape({
    weight: PropTypes.number,
    filled: PropTypes.bool,
    color: PropTypes.string,
    zone: PropTypes.string
  })),
  color: PropTypes.string,
  size: PropTypes.oneOf(['xs', 'sm', 'md', 'lg']),
  showLabel: PropTypes.bool,
  labelFormat: PropTypes.func,
  animated: PropTypes.bool,
  indeterminate: PropTypes.bool,
  orientation: PropTypes.oneOf(['horizontal', 'vertical']),
  className: PropTypes.string
};

export default ProgressBar;
