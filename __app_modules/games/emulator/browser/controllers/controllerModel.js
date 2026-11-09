// controllerModel.js — pure reads of the audio-bridge Bluetooth snapshot
// (GET /api/v1/arcade-bluetooth/:deviceId). No I/O here.

export const findDevice = (state, address) => state?.devices?.find((d) => d.address === address) || null;

/** One word for what a device is doing, from OBSERVED state only. */
export function deviceStatus(device) {
  if (!device) return 'gone';
  if (device.bond === 'bonding') return 'pairing';
  if (device.bond === 'none') return 'nearby';
  if (device.connected === true) return 'connected';
  if (device.connected === false) return 'paired';
  return 'unknown'; // bonded, but the bridge cannot observe the HID link right now
}

export const STATUS_LABEL = {
  connected: 'Connected',
  paired: 'Paired · not connected',
  pairing: 'Pairing…',
  nearby: 'Found · not paired',
  unknown: 'Paired · link status unknown',
  gone: 'Not found',
};

const ORDER = { connected: 0, paired: 1, unknown: 2, pairing: 3, nearby: 4 };

/** Game controllers first by how usable they are; everything else is view-only. */
export function splitDevices(state) {
  const devices = state?.devices || [];
  const rank = (d) => ORDER[deviceStatus(d)] ?? 9;
  const byRank = (a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
  return {
    controllers: devices.filter((d) => d.manageable).sort(byRank),
    // View-only list = the TV's own paired gear (remote, keyboard). A search
    // also turns up neighbours' TVs and nameless beacons; those are noise here.
    others: devices.filter((d) => !d.manageable && d.bond !== 'none').sort(byRank),
  };
}

export function shortAddress(address) {
  return String(address || '').split(':').slice(-3).join(':');
}

/** Did an accepted single action show up in observed state? */
export function operationSettled(operation, state) {
  const device = findDevice(state, operation.address);
  switch (operation.action) {
    case 'connect': return device?.connected === true && device.profiles?.includes('input');
    case 'disconnect': return device?.connected === false;
    case 'pair': return device?.bond === 'bonded';
    case 'unpair': return !device || device.bond === 'none';
    case 'scan': return state.adapter.discovering;
    case 'scan/stop': return !state.adapter.discovering;
    case 'pairing': return operation.accept ? device?.bond === 'bonded' : device?.bond === 'none' && !state.pairing;
    default: return false;
  }
}

/**
 * A freshly discovered, unpaired game controller that is the one being
 * re-paired. 8BitDo pads keep their address per mode, but a pad switched to a
 * different mode comes back under a new one with the same name — so a name
 * match counts, but only when it is unambiguous.
 */
export function repairCandidate(state, { address, name }) {
  const fresh = (state?.devices || []).filter((d) => d.manageable && d.bond === 'none');
  const exact = fresh.find((d) => d.address === address);
  if (exact) return exact;
  const named = name ? fresh.filter((d) => d.name === name) : [];
  return named.length === 1 ? named[0] : null;
}
