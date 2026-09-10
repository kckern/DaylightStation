/**
 * Shared VolumeBoostService singleton. A boost opened through the device API
 * must be visible to every other reader of the same window — otherwise a boost
 * granted on one route silently fails to lift the cap on another.
 *
 * Mirrors 5_composition/modules/screenOverride.mjs, which exists for the same
 * reason.
 *
 * @module 5_composition/modules/volumeBoost
 */
import { VolumeBoostService } from '#apps/devices/services/VolumeBoostService.mjs';

/** @type {VolumeBoostService | null} */
let instance = null;

/** @param {{clock?:{now:()=>number}}} [opts] clock is used only on first construction. */
export function getVolumeBoostService({ clock } = {}) {
  if (!instance) instance = new VolumeBoostService(clock ? { clock } : {});
  return instance;
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  instance = null;
}
