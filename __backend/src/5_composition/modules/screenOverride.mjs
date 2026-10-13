/**
 * Shared ScreenOverrideService singleton. All three screen writers (piano
 * authority service, midi-wake service, device router) must read the SAME window,
 * so they obtain it here rather than each constructing their own.
 *
 * @module 5_composition/modules/screenOverride
 */
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

/** @type {ScreenOverrideService | null} */
let instance = null;

/** @param {{clock?:{now:()=>number}}} [opts] clock is used only on first construction. */
export function getScreenOverrideService({ clock } = {}) {
  if (!instance) instance = new ScreenOverrideService(clock ? { clock } : {});
  return instance;
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  instance = null;
}
