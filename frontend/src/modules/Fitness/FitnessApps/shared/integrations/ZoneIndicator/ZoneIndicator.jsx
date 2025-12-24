import React from 'react';
import PropTypes from 'prop-types';
import './ZoneIndicator.scss';

const ZoneIndicator = ({
  zone = 0,
  label,
  size = 'md',
  className,
  ...props
}) => {
  const getZoneColor = (z) => {
    switch (Number(z)) {
      case 1: return 'var(--zone-gray)';
      case 2: return 'var(--zone-blue)';
      case 3: return 'var(--zone-green)';
      case 4: return 'var(--zone-yellow)';
      case 5: return 'var(--zone-red)';
      default: return 'var(--app-text-muted)';
    }
  };

  const color = getZoneColor(zone);

  return (
    <div 
      className={`zone-indicator zone-indicator--${size} ${className || ''}`} 
      style={{ '--zone-color': color }}
      {...props}
    >
      <div className="zone-indicator__badge">
        Z{zone}
      </div>
      {label && <div className="zone-indicator__label">{label}</div>}
    </div>
  );
};

ZoneIndicator.propTypes = {
  zone: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  label: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  className: PropTypes.string
};

export default ZoneIndicator;
