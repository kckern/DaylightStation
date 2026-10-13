/**
 * Pure mechanics for the single-slot, latest-wins fitness toast.
 * No React — trivially unit-testable. Consumed by FitnessContext.
 */

export const DEFAULT_TOAST_DURATION_MS = 2500;
export const DEFAULT_TOAST_VARIANT = 'info';

/**
 * Stamp a toast payload with its slot id and fill in defaults.
 * @param {Object} toast - { avatarUrl?, icon?, title, subtitle?, durationMs?, variant? }
 * @param {number} id - monotonic slot id (a new id re-triggers the animation/countdown)
 * @returns {Object} normalized toast with a guaranteed id, durationMs, variant
 */
export function normalizeToast(toast, id) {
  const base = toast && typeof toast === 'object' ? toast : {};
  const durationMs = Number.isFinite(base.durationMs) ? base.durationMs : DEFAULT_TOAST_DURATION_MS;
  const variant = base.variant || DEFAULT_TOAST_VARIANT;
  return { ...base, id, durationMs, variant };
}

/**
 * Whether a dismiss request for `id` should clear the current toast.
 * Guards against a stale exit timer clearing a newer toast that already replaced it.
 * @param {Object|null} currentToast
 * @param {number} id
 * @returns {boolean}
 */
export function dismissMatches(currentToast, id) {
  return Boolean(currentToast) && currentToast.id === id;
}
