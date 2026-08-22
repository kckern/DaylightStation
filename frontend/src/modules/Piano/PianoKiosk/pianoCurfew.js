import { isWithinWindow } from './timeWindow.js';

/**
 * Curfew: after the household's cut-off the kiosk menu goes dark — every tile
 * and every activity card greys out and stops responding to touch. The piano
 * itself is untouched: sitting down and playing still auto-enters Studio (see
 * useAutoStudioEntry), so free play at any hour works, while "put on a course /
 * pick a game" is closed for the night.
 *
 * Pure; the caller supplies `now` (and the hook re-evaluates on a timer).
 */

// Off by default: the household's real cut-off is config-driven
// (data/household/piano/config.yml → `curfew:`). Mirrors
// PIANO_CONFIG_DEFAULTS.curfew.
export const CURFEW_DEFAULTS = { enabled: false, start: '19:00', end: '06:00' };

/**
 * Is the kiosk under curfew at `now`?
 *
 * Fail-open in both directions: `enabled: false` or a malformed window means no
 * curfew, so a config typo can never grey the kiosk out permanently.
 *
 * @param {Date} now
 * @param {{enabled?: boolean, start?: string, end?: string}|null} curfew
 * @returns {boolean}
 */
export function isCurfewActive(now, curfew) {
  if (!curfew || curfew.enabled === false) return false;
  return isWithinWindow(now, curfew);
}

export default isCurfewActive;
