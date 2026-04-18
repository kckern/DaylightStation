/**
 * Pure helpers for CycleRiderSwapModal (Task 24).
 *
 * Kept in their own module so they can be unit-tested under jest's
 * `testEnvironment: 'node'` without pulling in React / JSX / ReactDOM
 * (matches the Task 20/21 precedent for overlay helpers).
 */

/**
 * Format a "cooldown: ~N min" hint for a rider whose per-user cycle
 * cooldown has not yet expired.
 *
 * In practice the modal's `eligibleUsers` list is pre-filtered by the
 * engine (riders on cooldown are excluded from `swapEligibleUsers`), so
 * this hint is rarely shown. It exists for callers that pass an
 * unfiltered list, or for riders whose cooldown expired between engine
 * tick and render.
 *
 * @param {number|null|undefined} cooldownUntilMs - Unix epoch ms at which
 *   this rider's cooldown expires, or null/undefined for no cooldown.
 * @param {number|null|undefined} now - Engine's current time in ms.
 * @returns {string|null} Hint text like "cooldown: ~3 min", or null if no
 *   active cooldown should be surfaced.
 */
export function formatCooldownHint(cooldownUntilMs, now) {
  if (!cooldownUntilMs || !now) return null;
  if (cooldownUntilMs <= now) return null;
  const remainingMs = cooldownUntilMs - now;
  const remainingMin = Math.ceil(remainingMs / 60000);
  return `cooldown: ~${remainingMin} min`;
}
