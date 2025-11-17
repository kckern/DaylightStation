import React from 'react';

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

export const TouchVolumeButtons = ({ controlId, currentLevel, disabled, onSelect }) => (
  <div
    className={`touch-volume ${disabled ? 'disabled' : ''}`}
    role="group"
    aria-disabled={disabled}
    aria-labelledby={`${controlId}-label`}
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
          onClick={() => !disabled && onSelect(level)}
          disabled={disabled}
          aria-pressed={isActive}
          aria-label={level === 0 ? 'Mute / Off' : `${level}% volume`}
        />
      );
    })}
  </div>
);
