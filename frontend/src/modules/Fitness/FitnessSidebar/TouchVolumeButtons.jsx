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

const handleVolumeSelect = (e, onSelect) => {
  const container = e.currentTarget;
  //determine x position of touch/click relative to the container element
  const rect = container.getBoundingClientRect();
  const rectWidth = rect.width;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const xPos = clientX - rect.left;
  const percent = (xPos / rectWidth) * 100;
  
  // Make it easier to select zero by expanding its tolerance
  if (percent <= 7.5) {
    onSelect(0);
    return;
  }
  
  const level = snapToTouchLevel(percent);
  onSelect(level);
};


export const TouchVolumeButtons = ({ controlId, currentLevel, disabled, onSelect }) => (
  <div
    className={`touch-volume ${disabled ? 'disabled' : ''}`}
    role="group"
    aria-disabled={disabled}
    aria-labelledby={`${controlId}-label`}
    onTouchStart={(e) => !disabled && handleVolumeSelect(e, onSelect)}
    onClick={(e) => !disabled && handleVolumeSelect(e, onSelect)}
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
