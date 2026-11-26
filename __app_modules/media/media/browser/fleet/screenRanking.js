// Long screen lists (spec addendum 2026-11-26 (b), "smart long lists"): Play
// on…, Fling, Move to…, Send elsewhere, the aim checkboxes and the Remote's
// screen switcher all show a few screens, then More. One ranking for all of
// them:
//
//   1. `preferredIds` (the aim, or the screen ▶ would use), in their order;
//   2. habit weight — how much this browser has sent things of this kind
//      there (habits/mediaHabits.js `screensFor`), strongest first;
//   3. how "there" it is now: playing, paused, … idle, then asleep/off and
//      unknown (fleet/browserLiveness.js, the Devices page's own order);
//   4. by name.
// Browser tabs rank after every screen and never take a top place unless
// preferred, used before or kept. Asleep screens fall under More whenever
// enough better ones exist (a house whose screens are all asleep still shows
// its first few).
import { liveRank } from "./browserLiveness.js";
import { deviceName } from "./deviceDisplay.js";

export const SCREEN_TOP_N = 3;

export function isBrowserDevice(device) {
  return device?.type === 'browser' || String(device?.id ?? '').startsWith('browser:');
}

/** Comparator for the order above. */
export function screenComparator({ preferredIds = [], weights = null } = {}) {
  const preferred = new Map((preferredIds ?? []).map((id, index) => [id, index]));
  const weightOf = (device) => weights?.get?.(device.id) ?? 0;
  return (a, b) => {
    const pa = preferred.has(a.id) ? preferred.get(a.id) : Infinity;
    const pb = preferred.has(b.id) ? preferred.get(b.id) : Infinity;
    if (pa !== pb) return pa - pb;
    const wa = weightOf(a);
    const wb = weightOf(b);
    if (wa !== wb) return wb - wa;
    const ba = isBrowserDevice(a) ? 1 : 0;
    const bb = isBrowserDevice(b) ? 1 : 0;
    if (ba !== bb) return ba - bb;
    const la = liveRank(a);
    const lb = liveRank(b);
    if (la !== lb) return la - lb;
    return deviceName(a).localeCompare(deviceName(b));
  };
}

/** `devices` in that order (a new array). */
export function rankScreens(devices = [], options = {}) {
  return [...(devices ?? [])].sort(screenComparator(options));
}

/** Which screens may take a top place: not a browser tab, unless chosen or used. */
export function screenCanTop({ preferredIds = [], weights = null } = {}) {
  const preferred = new Set(preferredIds ?? []);
  return (device) => !isBrowserDevice(device) || preferred.has(device.id) || (weights?.get?.(device.id) ?? 0) > 0;
}
