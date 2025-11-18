import React from 'react';

export const TOUCH_VOLUME_LEVELS_LINEAR = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const TOUCH_VOLUME_LEVELS_LOGARITHMIC = [0, 1, 2, 4, 7, 12, 20, 35, 55, 80, 100];

export const snapToTouchLevel = (percent, volumeScale = 'linear') => {
  if (!Number.isFinite(percent)) return 0;
  const levels = volumeScale === 'logarithmic' ? TOUCH_VOLUME_LEVELS_LOGARITHMIC : TOUCH_VOLUME_LEVELS_LINEAR;
  return levels.reduce((closest, level) => (
    Math.abs(level - percent) < Math.abs(closest - percent) ? level : closest
  ), levels[0]);
};

export const snapToTouchLevelLinear = (percent) => snapToTouchLevel(percent, 'linear');
export const snapToTouchLevelLog = (percent) => snapToTouchLevel(percent, 'logarithmic');

export const linearVolumeFromLevel = (level) => {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level / 100));
};

export const linearLevelFromVolume = (volume) => {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume * 100)));
};

export const logVolumeFromLevel = (level) => {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const exponent = (level - 100) / 50;
  return Math.min(1, Math.max(0, Math.pow(10, exponent)));
};

export const logLevelFromVolume = (volume) => {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  const percent = 100 + 50 * Math.log10(volume);
  return Math.min(100, Math.max(0, Math.round(percent)));
};

export const TouchVolumeButtons = ({ controlId, currentLevel, disabled, onSelect, volumeScale = 'linear' }) => {
  const volumeLevels = volumeScale === 'logarithmic' ? TOUCH_VOLUME_LEVELS_LOGARITHMIC : TOUCH_VOLUME_LEVELS_LINEAR;
  return (
    <div
      className={`touch-volume ${disabled ? 'disabled' : ''}`}
      role="group"
      aria-disabled={disabled}
      aria-labelledby={`${controlId}-label`}
    >
      {volumeLevels.map((level) => {
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
          onTouchStart={() => !disabled && onSelect(level)}
          onClick={() => !disabled && onSelect(level)}
          disabled={disabled}
          aria-pressed={isActive}
          aria-label={level === 0 ? 'Mute / Off' : `${level}% volume`}
        />
      );
    })}
    </div>
  );
};
