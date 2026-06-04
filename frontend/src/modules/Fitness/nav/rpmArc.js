// frontend/src/modules/Fitness/nav/rpmArc.js
/**
 * Deterministic wandering-RPM value for a 1 Hz arc driver. tick = seconds since
 * the arc started; rpm = base + amp·sin(2π·tick/periodS), clamped to 0..150.
 */
export function rpmArcValue(tick, { base = 70, amp = 15, periodS = 20 } = {}) {
  const raw = base + amp * Math.sin((2 * Math.PI * tick) / periodS);
  return Math.max(0, Math.min(150, Math.round(raw)));
}

export default rpmArcValue;
