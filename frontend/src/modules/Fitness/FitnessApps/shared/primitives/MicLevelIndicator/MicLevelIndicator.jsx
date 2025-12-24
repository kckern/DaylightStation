import React from 'react';
import PropTypes from 'prop-types';
import './MicLevelIndicator.scss';

/**
 * MicLevelIndicator - Visual microphone input level display
 * 
 * Extracted from VoiceMemoOverlay.jsx for reuse.
 */
const MicLevelIndicator = ({
  level = 0,
  bars = 5,
  orientation = 'horizontal',
  size = 'md',
  variant = 'bars',
  activeColor,
  className,
  ...props
}) => {
  // Normalize level to 0-100
  const normalizedLevel = Math.min(100, Math.max(0, level));
  
  const combinedClassName = [
    'mic-level-indicator',
    `mic-level-indicator--${orientation}`,
    `mic-level-indicator--${size}`,
    `mic-level-indicator--${variant}`,
    className
  ].filter(Boolean).join(' ');

  const style = activeColor ? { '--mic-active-color': activeColor } : undefined;

  if (variant === 'waveform') {
    return (
      <div className={combinedClassName} style={style} {...props}>
        <div 
          className="mic-level-indicator__waveform"
          style={{ '--level': normalizedLevel / 100 }}
        >
          {Array.from({ length: bars }, (_, i) => (
            <div 
              key={i} 
              className="mic-level-indicator__wave-bar"
              style={{ 
                animationDelay: `${i * 0.1}s`,
                height: `${20 + Math.random() * 60}%`
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // Default bars variant
  const activeBars = Math.ceil((normalizedLevel / 100) * bars);

  return (
    <div className={combinedClassName} style={style} {...props}>
      <div className="mic-level-indicator__bars">
        {Array.from({ length: bars }, (_, i) => (
          <div 
            key={i}
            className={`mic-level-indicator__bar ${i < activeBars ? 'mic-level-indicator__bar--active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};

MicLevelIndicator.propTypes = {
  /** Audio level 0-100 */
  level: PropTypes.number,
  /** Number of bars/segments */
  bars: PropTypes.number,
  /** Bar orientation */
  orientation: PropTypes.oneOf(['horizontal', 'vertical']),
  /** Display size */
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  /** Visual variant */
  variant: PropTypes.oneOf(['bars', 'waveform', 'arc']),
  /** Custom active color */
  activeColor: PropTypes.string,
  /** Additional CSS class */
  className: PropTypes.string
};

export default MicLevelIndicator;
