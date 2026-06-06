/**
 * Inline-style math for the governance "warning" scrim.
 *
 * The scrim darkens / blurs / desaturates the video during the grace period and
 * ramps that intensity up as the countdown depletes toward lock, so the screen
 * visibly "closes in." The curve is ease-in (slow then fast), so it stays calm
 * early and slams on in the final seconds before lock.
 *
 * Intensity runs 0 at grace-start (full time remaining) to 1 at lock (no time).
 */

// Ramp endpoints [start, lock] for each effect.
const RAMP = {
  darkness: [0.08, 0.82], // black-veil alpha
  blur: [0, 7],           // px
  grayscale: [0.1, 1],
  sepia: [0.1, 0.4]
};
const EASE_EXPONENT = 1.6;

// Fallback when there is no usable countdown (missing / non-finite deadline data):
// never look weaker than the original static scrim.
const STATIC_FALLBACK = {
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(4px) grayscale(1) sepia(0.4)',
  WebkitBackdropFilter: 'blur(4px) grayscale(1) sepia(0.4)'
};

const lerp = (from, to, t) => from + (to - from) * t;
const round = (n, precision = 3) => {
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
};

/**
 * Compute the warning scrim's inline style at a point in the grace countdown.
 *
 * @param {number|null} remainingSeconds - seconds left before lock
 * @param {number} totalSeconds - total grace period
 * @returns {{ backgroundColor: string, backdropFilter: string, WebkitBackdropFilter: string }}
 */
export function computeWarningScrimStyle(remainingSeconds, totalSeconds) {
  if (!Number.isFinite(remainingSeconds) || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return { ...STATIC_FALLBACK };
  }
  const frac = Math.max(0, Math.min(1, remainingSeconds / totalSeconds)); // 1 = full time, 0 = lock
  const intensity = Math.pow(1 - frac, EASE_EXPONENT);

  const darkness = round(lerp(RAMP.darkness[0], RAMP.darkness[1], intensity));
  const blur = round(lerp(RAMP.blur[0], RAMP.blur[1], intensity), 2);
  const grayscale = round(lerp(RAMP.grayscale[0], RAMP.grayscale[1], intensity));
  const sepia = round(lerp(RAMP.sepia[0], RAMP.sepia[1], intensity));

  const filter = `blur(${blur}px) grayscale(${grayscale}) sepia(${sepia})`;
  return {
    backgroundColor: `rgba(0, 0, 0, ${darkness})`,
    backdropFilter: filter,
    WebkitBackdropFilter: filter
  };
}

export default computeWarningScrimStyle;
