// Where a deliberate ▶ goes, and what it is called. ONE rule, used by every
// surface that offers a play (search rows, home tiles, browse rows, detail):
//
//   1. something is aimed (the header destination)   → there
//   2. this browser last played this kind of thing on a screen that can still
//      take it                                       → that screen ("learned")
//   3. a film or episode nobody has chosen a screen for yet → ASK: the ▶
//      reads "Play on…" and opens the screen list (This device included).
//      One tap the first time; the choice is learned. A video never plays
//      here by default — that default was the original complaint.
//   4. otherwise (music, unknown kinds)              → this device
//
// The ▶ always says which, by name, so a play is never a surprise: learning
// only changes what the one-tap button offers, never what a tap on a row does
// (a tap only ever opens the item).
import { deviceKind } from "../cast/castCopy.js";
import { deviceName } from "../fleet/deviceDisplay.js";

/**
 * Can `device` play a `kind` item? A speaker plays sound only; a screen that
 * takes no content (listed for the house view only, e.g. a gym display whose
 * page has no receiver) takes nothing; browsers and content screens take all.
 * `kind` null means unknown: allow every device that takes content at all.
 */
export function canPlayOn(device, kind) {
  if (!device?.id) return false;
  if (device.type === 'browser' || String(device.id).startsWith('browser:')) return true;
  if (deviceKind(device) === 'speaker') return kind !== 'video';
  // Listed for the house view only (`fleet: true`) with no way to receive
  // content: a send there is acknowledged by nobody and fails 90 s later.
  if (device.fleet === true && !device.content_control) return false;
  return true;
}

/**
 * Resolve the destination for a play of `kind`.
 * @param {{ aimIds: string[], learnedIds: string[]|null, devices: object[], localId: string|null, kind: string|null }} input
 * @returns {{ targetIds: string[], source: 'aim'|'learned'|'here', devices: object[] }}
 */
export function resolvePlayDestination({ aimIds = [], learnedIds = null, devices = [], localId = null, kind = null }) {
  if (aimIds.length > 0) {
    return { targetIds: aimIds, source: 'aim', devices: aimIds.map(id => devices.find(d => d.id === id)).filter(Boolean) };
  }
  // Chosen "this device" (or this browser's own id) is here, on purpose.
  if (Array.isArray(learnedIds) && learnedIds.filter(id => id !== localId).length === 0) {
    return { targetIds: [], source: 'here', devices: [] };
  }
  const learned = (learnedIds ?? []).filter(id => id !== localId);
  if (learned.length > 0) {
    const found = learned.map(id => devices.find(d => d.id === id));
    // Every learned screen must still exist and be able to take this kind of
    // thing; a half-valid set is not what the person chose, so fall back whole.
    if (found.every(device => device && canPlayOn(device, kind))) {
      return { targetIds: learned, source: 'learned', devices: found };
    }
  }
  if (kind === 'video') return { targetIds: [], source: 'ask', devices: [] };
  return { targetIds: [], source: 'here', devices: [] };
}

/**
 * The words on the ▶: `short` for a row button ("Office Screen", "Play"),
 * `sentence` for its accessible name and the detail page ("Play on Office
 * Screen", "Play here").
 */
export function destinationLabels(destination, { verb = 'Play' } = {}) {
  if (destination?.source === 'ask') return { short: `${verb} on…`, sentence: `${verb} on…` };
  if (!destination || destination.targetIds.length === 0) {
    return { short: verb, sentence: `${verb} here` };
  }
  const names = destination.devices.length > 0
    ? destination.devices.map(device => deviceName(device))
    : destination.targetIds.map(id => deviceName(null, id));
  const joined = names.length <= 2 ? names.join(' and ') : `${names[0]} and ${names.length - 1} more`;
  return { short: joined, sentence: `${verb} on ${joined}` };
}
