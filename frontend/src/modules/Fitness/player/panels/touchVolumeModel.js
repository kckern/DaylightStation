// touchVolumeModel.js — level/volume conversion math for TouchVolumeButtons.jsx,
// split out so Fast Refresh can hot-reload the button strip on its own.

export const TOUCH_VOLUME_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

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

// Logarithmic level↔volume curve: the touch midpoint (level 50) maps to 10%
// output, stretching the quiet range so low buttons are meaningful volume
// choices instead of "already too loud". Shared by the music player and the
// dance party.
const LOG_CURVE_TARGET_LEVEL = 50; // midpoint of the touch buttons
const LOG_CURVE_TARGET_VOLUME = 0.1; // 10% output should align with midpoint
const LOG_CURVE_EXPONENT_PER_LEVEL = (() => {
  const denominator = LOG_CURVE_TARGET_LEVEL - 100; // negative value
  const numerator = Math.log10(Math.max(0.0001, LOG_CURVE_TARGET_VOLUME)); // avoid log10(0)
  if (denominator === 0) return -0.01; // fallback to gentle slope
  return numerator / denominator;
})();

export const logVolumeFromLevel = (level) => {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const exponent = (level - 100) * LOG_CURVE_EXPONENT_PER_LEVEL;
  return Math.min(1, Math.max(0, Math.pow(10, exponent)));
};

export const logLevelFromVolume = (volume) => {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  const percent = 100 + (Math.log10(volume) / (LOG_CURVE_EXPONENT_PER_LEVEL || -0.01));
  return Math.min(100, Math.max(0, Math.round(percent)));
};
