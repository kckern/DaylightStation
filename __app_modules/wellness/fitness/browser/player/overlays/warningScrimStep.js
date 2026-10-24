/**
 * Which of the warning scrim's fixed steps applies at a point in the grace
 * countdown.
 *
 * The warning darkens and desaturates the video as the countdown runs out, so
 * the screen visibly closes in. It used to do that with a full-screen
 * `backdrop-filter: blur() grayscale() sepia()` rewritten every 0.5s, each
 * rewrite restarting a 0.5s filter transition — a filter animating nonstop for
 * the whole grace period over a playing video, in the same picture as the rider
 * chips. On the garage's WebRender that is the prime suspect for the chips
 * flickering soft (ops:docs/_wip/bugs/2026-10-23-fitness-governance-chip-layer-blur-thrash.md).
 *
 * Now the ramp is five fixed steps. The step changes four times per warning;
 * the scrim's darkness eases between steps (background-color only), and the
 * video's desaturation is a static `filter` on the <video> per step. No blur.
 * The per-step values live in GovernanceStateOverlay.scss (`data-step`).
 */

// Remaining-time fractions at which steps 1..4 begin.
const STEP_THRESHOLDS = [0.75, 0.5, 0.25, 0.1];

export const SCRIM_STEP_COUNT = STEP_THRESHOLDS.length + 1;

// No usable countdown (missing deadline): never look weaker than the original
// static scrim, which was a firm dark/grey.
export const SCRIM_FALLBACK_STEP = 3;

/**
 * @param {number|null} remainingSeconds - seconds left before lock
 * @param {number} totalSeconds - total grace period
 * @returns {number} step 0 (just started) .. 4 (about to lock)
 */
export function warningScrimStep(remainingSeconds, totalSeconds) {
  if (!Number.isFinite(remainingSeconds) || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return SCRIM_FALLBACK_STEP;
  }
  const frac = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
  let step = 0;
  for (const threshold of STEP_THRESHOLDS) if (frac <= threshold) step += 1;
  return step;
}

export default warningScrimStep;
