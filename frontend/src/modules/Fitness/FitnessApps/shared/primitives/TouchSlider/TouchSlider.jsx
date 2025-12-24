import React, { useRef, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import './TouchSlider.scss';

const TouchSlider = ({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onChangeEnd,
  orientation = 'horizontal',
  label,
  showValue = true,
  disabled = false,
  className,
  ...props
}) => {
  const trackRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const calculateValue = (clientX, clientY) => {
    const track = trackRef.current;
    if (!track) return min;

    const rect = track.getBoundingClientRect();
    let percentage;

    if (orientation === 'horizontal') {
      percentage = (clientX - rect.left) / rect.width;
    } else {
      // Vertical sliders usually go from bottom to top
      percentage = 1 - ((clientY - rect.top) / rect.height);
    }

    percentage = Math.max(0, Math.min(1, percentage));
    
    const rawValue = min + percentage * (max - min);
    const steppedValue = Math.round(rawValue / step) * step;
    
    return Math.max(min, Math.min(max, steppedValue));
  };

  const handleStart = (clientX, clientY) => {
    if (disabled) return;
    setIsDragging(true);
    const newValue = calculateValue(clientX, clientY);
    setLocalValue(newValue);
    onChange?.(newValue);
  };

  const handleMove = (clientX, clientY) => {
    if (!isDragging || disabled) return;
    const newValue = calculateValue(clientX, clientY);
    setLocalValue(newValue);
    onChange?.(newValue);
  };

  const handleEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    onChangeEnd?.(localValue);
  };

  // Mouse events
  const onMouseDown = (e) => handleStart(e.clientX, e.clientY);
  
  useEffect(() => {
    const onMouseMove = (e) => handleMove(e.clientX, e.clientY);
    const onMouseUp = () => handleEnd();

    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, localValue]);

  // Touch events
  const onTouchStart = (e) => handleStart(e.touches[0].clientX, e.touches[0].clientY);
  const onTouchMove = (e) => handleMove(e.touches[0].clientX, e.touches[0].clientY);
  const onTouchEnd = () => handleEnd();

  const percentage = ((localValue - min) / (max - min)) * 100;

  const combinedClassName = [
    'app-touch-slider',
    `app-touch-slider--${orientation}`,
    disabled ? 'app-touch-slider--disabled' : '',
    isDragging ? 'app-touch-slider--dragging' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={combinedClassName} {...props}>
      {(label || showValue) && (
        <div className="app-touch-slider__header">
          {label && <span className="app-touch-slider__label">{label}</span>}
          {showValue && <span className="app-touch-slider__value">{Math.round(localValue)}</span>}
        </div>
      )}
      
      <div 
        className="app-touch-slider__track-container"
        ref={trackRef}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="app-touch-slider__track">
          <div 
            className="app-touch-slider__fill" 
            style={{ 
              [orientation === 'horizontal' ? 'width' : 'height']: `${percentage}%` 
            }} 
          />
          <div 
            className="app-touch-slider__thumb"
            style={{ 
              [orientation === 'horizontal' ? 'left' : 'bottom']: `${percentage}%` 
            }}
          />
        </div>
      </div>
    </div>
  );
};

TouchSlider.propTypes = {
  value: PropTypes.number,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
  onChange: PropTypes.func,
  onChangeEnd: PropTypes.func,
  orientation: PropTypes.oneOf(['horizontal', 'vertical']),
  label: PropTypes.string,
  showValue: PropTypes.bool,
  disabled: PropTypes.bool,
  className: PropTypes.string
};

export default TouchSlider;
