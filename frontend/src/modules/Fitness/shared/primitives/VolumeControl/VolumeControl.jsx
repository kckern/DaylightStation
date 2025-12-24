import React, { useState, useCallback, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { AppIconButton } from '../AppIconButton';
import './VolumeControl.scss';

/**
 * VolumeControl - Touch-friendly volume control with optional mute
 * 
 * Extracted from TouchVolumeButtons.jsx for reuse.
 */

// Volume icons
const VolumeHighIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
  </svg>
);

const VolumeLowIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
  </svg>
);

const VolumeMuteIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
  </svg>
);

const VolumeControl = ({
  value = 50,
  min = 0,
  max = 100,
  step = 5,
  onChange,
  onChangeEnd,
  onMuteToggle,
  muted = false,
  showMute = true,
  showValue = true,
  showButtons = true,
  orientation = 'vertical',
  size = 'md',
  steps,
  className,
  ...props
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef(null);

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const snapToStep = useCallback((val) => {
    if (steps && steps.length > 0) {
      // Find closest step
      return steps.reduce((prev, curr) => 
        Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev
      );
    }
    return Math.round(val / step) * step;
  }, [steps, step]);

  const handleChange = useCallback((newValue) => {
    const clamped = Math.min(max, Math.max(min, newValue));
    const snapped = snapToStep(clamped);
    setLocalValue(snapped);
    onChange?.(snapped);
  }, [min, max, snapToStep, onChange]);

  const handleIncrement = useCallback(() => {
    handleChange(localValue + step);
    onChangeEnd?.(snapToStep(localValue + step));
  }, [localValue, step, handleChange, onChangeEnd, snapToStep]);

  const handleDecrement = useCallback(() => {
    handleChange(localValue - step);
    onChangeEnd?.(snapToStep(localValue - step));
  }, [localValue, step, handleChange, onChangeEnd, snapToStep]);

  const handleSliderInteraction = useCallback((clientX, clientY) => {
    if (!sliderRef.current) return;
    
    const rect = sliderRef.current.getBoundingClientRect();
    let percentage;
    
    if (orientation === 'vertical') {
      percentage = 1 - ((clientY - rect.top) / rect.height);
    } else {
      percentage = (clientX - rect.left) / rect.width;
    }
    
    percentage = Math.min(1, Math.max(0, percentage));
    const newValue = min + percentage * (max - min);
    handleChange(newValue);
  }, [orientation, min, max, handleChange]);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    handleSliderInteraction(e.clientX, e.clientY);
  };

  const handleTouchStart = (e) => {
    setIsDragging(true);
    const touch = e.touches[0];
    handleSliderInteraction(touch.clientX, touch.clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      handleSliderInteraction(clientX, clientY);
    };

    const handleEnd = () => {
      setIsDragging(false);
      onChangeEnd?.(localValue);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, handleSliderInteraction, onChangeEnd, localValue]);

  const percentage = ((localValue - min) / (max - min)) * 100;
  const displayValue = muted ? 0 : localValue;

  const combinedClassName = [
    'volume-control',
    `volume-control--${orientation}`,
    `volume-control--${size}`,
    muted ? 'volume-control--muted' : '',
    isDragging ? 'volume-control--dragging' : '',
    className
  ].filter(Boolean).join(' ');

  const VolumeIcon = muted || displayValue === 0 
    ? VolumeMuteIcon 
    : displayValue < 50 
      ? VolumeLowIcon 
      : VolumeHighIcon;

  return (
    <div className={combinedClassName} {...props}>
      {showButtons && orientation === 'vertical' && (
        <button 
          className="volume-control__btn volume-control__btn--up"
          onClick={handleIncrement}
          aria-label="Increase volume"
        >
          +
        </button>
      )}

      <div className="volume-control__slider-wrapper">
        {showMute && (
          <button 
            className="volume-control__mute-btn"
            onClick={() => onMuteToggle?.(!muted)}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <VolumeIcon />
          </button>
        )}

        <div 
          className="volume-control__slider"
          ref={sliderRef}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          <div className="volume-control__track">
            <div 
              className="volume-control__fill"
              style={{ 
                [orientation === 'vertical' ? 'height' : 'width']: `${muted ? 0 : percentage}%` 
              }}
            />
            <div 
              className="volume-control__thumb"
              style={{ 
                [orientation === 'vertical' ? 'bottom' : 'left']: `${muted ? 0 : percentage}%` 
              }}
            />
          </div>
        </div>

        {showValue && (
          <span className="volume-control__value">
            {Math.round(displayValue)}
          </span>
        )}
      </div>

      {showButtons && orientation === 'vertical' && (
        <button 
          className="volume-control__btn volume-control__btn--down"
          onClick={handleDecrement}
          aria-label="Decrease volume"
        >
          −
        </button>
      )}

      {showButtons && orientation === 'horizontal' && (
        <div className="volume-control__btn-row">
          <button 
            className="volume-control__btn"
            onClick={handleDecrement}
            aria-label="Decrease volume"
          >
            −
          </button>
          <button 
            className="volume-control__btn"
            onClick={handleIncrement}
            aria-label="Increase volume"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
};

VolumeControl.propTypes = {
  /** Current volume value */
  value: PropTypes.number,
  /** Minimum value */
  min: PropTypes.number,
  /** Maximum value */
  max: PropTypes.number,
  /** Step increment */
  step: PropTypes.number,
  /** Called on value change */
  onChange: PropTypes.func,
  /** Called when interaction ends */
  onChangeEnd: PropTypes.func,
  /** Called when mute is toggled */
  onMuteToggle: PropTypes.func,
  /** Muted state */
  muted: PropTypes.bool,
  /** Show mute button */
  showMute: PropTypes.bool,
  /** Show numeric value */
  showValue: PropTypes.bool,
  /** Show +/- buttons */
  showButtons: PropTypes.bool,
  /** Control orientation */
  orientation: PropTypes.oneOf(['vertical', 'horizontal']),
  /** Control size */
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  /** Snap points array (overrides step) */
  steps: PropTypes.arrayOf(PropTypes.number),
  /** Additional CSS class */
  className: PropTypes.string
};

export default VolumeControl;
