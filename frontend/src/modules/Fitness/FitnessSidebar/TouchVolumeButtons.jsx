import React, { useRef } from 'react';

const TOUCH_VOLUME_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export const snapToTouchLevel = (percent) => {
  if (!Number.isFinite(percent)) return 0;
  return TOUCH_VOLUME_LEVELS.reduce((closest, level) => (
    Math.abs(level - percent) < Math.abs(closest - percent) ? level : closest
  ), TOUCH_VOLUME_LEVELS[0]);
};

export const linearVolumeFromLevel = (level) => {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level / 100));
};

export const linearLevelFromVolume = (volume) => {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume * 100)));
};

export const TouchVolumeButtons = ({ controlId, currentLevel, disabled, onSelect }) => {
  const mountTimeRef = useRef(performance.now());
  
  const handlePointerDown = (e) => {
    if (disabled) return;
    
    // BUG-04 Fix: Ignore events that occurred before this component was mounted
    const eventTime = e.nativeEvent?.timeStamp || performance.now();
    if (eventTime <= mountTimeRef.current) {
      return;
    }

    // Interaction Isolation
    if (typeof e.preventDefault === 'function') {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    }

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const rectWidth = rect.width;
    const clientX = e.clientX;
    const xPos = clientX - rect.left;
    const percent = (xPos / rectWidth) * 100;
    
    if (percent <= 7.5) {
      onSelect(0);
    } else {
      onSelect(snapToTouchLevel(percent));
    }
  };

  return (
    <div
      className={`touch-volume ${disabled ? 'disabled' : ''}`}
      role="group"
      aria-disabled={disabled}
      aria-labelledby={`${controlId}-label`}
      onPointerDown={handlePointerDown}
    >
      {TOUCH_VOLUME_LEVELS.map((level) => {
        const isActive = level === currentLevel;
        const isOn = currentLevel > 0 && level > 0 && level <= currentLevel;
        const className = [
          'touch-volume-button',
          isOn ? 'on' : 'off',
          isActive ? 'active' : ''
        ].filter(Boolean).join(' ');
        return (
          <button
            key={level}
            type="button"
            className={className}
            disabled={disabled}
            aria-pressed={isActive}
            aria-label={level === 0 ? 'Mute / Off' : `${level}% volume`}
          />
        );
      })}
    </div>
  );
};
