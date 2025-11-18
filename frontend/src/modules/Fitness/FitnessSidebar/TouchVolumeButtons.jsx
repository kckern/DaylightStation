import React, { useRef } from 'react';

export const TOUCH_VOLUME_LEVELS_LINEAR = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const TOUCH_VOLUME_LEVELS_LOGARITHMIC = [0, 2, 5, 9, 15, 25, 40, 60, 80, 90, 100];

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
  const containerRef = useRef(null);

  const selectLevelFromEvent = (event) => {
    if (disabled || typeof onSelect !== 'function') return;

    if (event.type && event.type.startsWith('touch') && event.preventDefault) {
      event.preventDefault();
    }

    const rect = containerRef.current?.getBoundingClientRect?.();
    let clientX;

    if (event.touches && event.touches[0]) {
      clientX = event.touches[0].clientX;
    } else if (event.changedTouches && event.changedTouches[0]) {
      clientX = event.changedTouches[0].clientX;
    } else if (typeof event.clientX === 'number') {
      clientX = event.clientX;
    }

    if (rect && rect.width > 0 && typeof clientX === 'number') {
      const relative = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 0.999999);
      const index = Math.min(volumeLevels.length - 1, Math.floor(relative * volumeLevels.length));
      onSelect(volumeLevels[index]);
      return;
    }

    const fallbackLevel = Number(event.target?.getAttribute?.('data-level'));
    if (Number.isFinite(fallbackLevel)) {
      onSelect(fallbackLevel);
    }
  };

  const handleTouchStart = (event) => selectLevelFromEvent(event);
  const handleClick = (event) => selectLevelFromEvent(event);

  return (
    <div
      ref={containerRef}
      className={`touch-volume ${disabled ? 'disabled' : ''}`}
      role="group"
      aria-disabled={disabled}
      aria-labelledby={`${controlId}-label`}
      onTouchStart={handleTouchStart}
      onClick={handleClick}
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
          disabled={disabled}
          data-level={level}
          aria-pressed={isActive}
          aria-label={level === 0 ? 'Mute / Off' : `${level}% volume`}
        />
      );
    })}
    </div>
  );
};
