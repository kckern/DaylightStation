// The order Tab walks through destinations in the search box: the usual film
// screen, then every other screen that can take a video (by name), then This
// device (the empty aim). Pure; callers supply the fleet's devices.
import { canPlayOn } from "./playDestination.js";
import { deviceName } from "../fleet/deviceDisplay.js";

const HERE = { targetIds: [], label: 'This device' };

/** Order-independent identity of an aim; the empty aim is 'local'. */
export function aimKey(ids) {
  const list = ids ?? [];
  return list.length === 0 ? 'local' : [...list].sort().join(',');
}

export function destinationCycle({ devices = [], usualIds = [], localId = null } = {}) {
  const screens = devices
    .filter((d) => d?.id && d.id !== localId && canPlayOn(d, 'video')
      && d.type !== 'browser' && !String(d.id).startsWith('browser:'))
    .map((d) => ({ id: d.id, label: deviceName(d) }));
  const usual = screens.find((s) => (usualIds ?? []).includes(s.id));
  const rest = screens
    .filter((s) => s !== usual)
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...(usual ? [usual] : []), ...rest]
    .map((s) => ({ targetIds: [s.id], label: s.label }))
    .concat([{ ...HERE }]);
}

export function nextDestination(cycle, currentIds, dir = 1) {
  const current = aimKey(currentIds);
  const index = cycle.findIndex((c) => aimKey(c.targetIds) === current);
  if (index < 0) return cycle[dir === -1 ? cycle.length - 1 : 0];
  return cycle[(index + dir + cycle.length) % cycle.length];
}
