import React from 'react';
import PropTypes from 'prop-types';
import './Gauge.scss';

const Gauge = ({
  value = 0,
  min = 0,
  max = 100,
  label,
  units,
  size = 'md',
  zones = [],
  showValue = true,
  animated = true,
  className,
  ...props
}) => {
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const rotation = (percentage / 100) * 180; // 180 degree gauge

  const getZoneColor = (val) => {
    if (!zones.length) return 'var(--app-action-primary)';
    const zone = zones.find(z => val >= z.min && val <= z.max);
    return zone ? zone.color : 'var(--app-text-secondary)';
  };

  const currentColor = getZoneColor(value);

  const combinedClassName = [
    'app-gauge',
    `app-gauge--${size}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={combinedClassName} {...props}>
      <div className="app-gauge__body">
        <div className="app-gauge__fill" style={{ transform: `rotate(${rotation}deg)`, backgroundColor: currentColor }}></div>
        <div className="app-gauge__cover">
          {showValue && (
            <div className="app-gauge__content">
              <span className="app-gauge__value" style={{ color: currentColor }}>{Math.round(value)}</span>
              {units && <span className="app-gauge__units">{units}</span>}
            </div>
          )}
          {label && <div className="app-gauge__label">{label}</div>}
        </div>
      </div>
    </div>
  );
};

Gauge.propTypes = {
  value: PropTypes.number,
  min: PropTypes.number,
  max: PropTypes.number,
  label: PropTypes.string,
  units: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  zones: PropTypes.arrayOf(PropTypes.shape({
    min: PropTypes.number,
    max: PropTypes.number,
    color: PropTypes.string
  })),
  showValue: PropTypes.bool,
  animated: PropTypes.bool,
  className: PropTypes.string
};

export default Gauge;
