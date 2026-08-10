export const GAIN_LEVELS = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

const MID_LEVEL = 50;
const MID_GAIN = 0.1;
const EXPONENT_PER_LEVEL = Math.log10(MID_GAIN) / (MID_LEVEL - 100);

export const snapToGainLevel = (percent) => {
  if (!Number.isFinite(percent)) return 0;
  return GAIN_LEVELS.reduce((closest, level) => (
    Math.abs(level - percent) < Math.abs(closest - percent) ? level : closest
  ), GAIN_LEVELS[0]);
};

export const gainFromLevel = (level) => {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(1, Math.max(0, 10 ** ((level - 100) * EXPONENT_PER_LEVEL)));
};

export const levelFromGain = (gain) => {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(100 + Math.log10(gain) / EXPONENT_PER_LEVEL)));
};
