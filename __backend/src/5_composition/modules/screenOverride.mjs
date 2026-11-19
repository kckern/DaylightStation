/**
 * Shared ScreenOverrideService singleton. All three screen writers (piano
 * authority service, midi-wake service, device router) must read the SAME window,
 * so they obtain it here rather than each constructing their own.
 *
 * @module 5_composition/modules/screenOverride
 */
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

import { createPianoScreenHoldStore } from '#adapters/devices/PianoScreenHoldStore.mjs';

function pianoHoldStore(configService, householdId) {
  const wake = configService?.getHouseholdAppConfig(householdId, 'piano')?.midi_wake;
  const deviceId = wake?.device_id || wake?.deviceId;
  if (!wake?.enabled || !deviceId) return null;
  const path = configService.getHouseholdPath('piano/screen-hold.json', householdId);
  return createPianoScreenHoldStore(deviceId, path);
}

/** @type {ScreenOverrideService | null} */
let instance = null;

/** @param {{clock?:{now:()=>number}}} [opts] clock is used only on first construction. */
export function getScreenOverrideService({ clock, configService, householdId = null } = {}) {
  if (!instance) instance = new ScreenOverrideService({ clock, store: pianoHoldStore(configService, householdId) });
  return instance;
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  instance = null;
}
