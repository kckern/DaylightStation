export const RACE_VALUE_LIMITS = {
  distance: { min: 100, max: 10000 },
  time: { min: 60, max: 1800 }
};
const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));

/**
 * Next stepper value for a race target. Distance steps 100 m below 1 km, 500 m above;
 * time steps one minute. An unknown type is treated as distance.
 * @param {string} type 'distance' (metres) or 'time' (seconds)
 * @param {number} value current value; non-finite or non-numeric returns the type's minimum
 * @param {number} dir +1 or -1; 0 returns the value clamped and snapped to the grid
 * @returns {number} the new value, always within RACE_VALUE_LIMITS for the type
 */
export function stepRaceValue(type, value, dir) {
  const isTime = type === 'time';
  const limits = isTime ? RACE_VALUE_LIMITS.time : RACE_VALUE_LIMITS.distance;
  if (typeof value !== 'number' || !Number.isFinite(value)) return limits.min;
  const d = Number.isFinite(dir) ? Math.sign(dir) : 0;
  if (isTime) return clamp((Math.round(value / 60) + d) * 60, limits);
  if (d === 0) {
    const step0 = value < 1000 ? 100 : 500;
    return clamp(Math.round(value / step0) * step0, limits);
  }
  const fine = d > 0 ? value < 1000 : value <= 1000;
  const step = fine ? 100 : 500;
  const snapped = d > 0 ? Math.floor(value / step) * step : Math.ceil(value / step) * step;
  return clamp(snapped + d * step, limits);
}
