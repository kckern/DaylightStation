// pairingGuide.js — pure helpers for the guided controller-pairing panel.
//
// Every controller-specific word (which buttons to hold, what the LED does,
// the legacy PIN) comes from the controller's `pairing:` block in
// media/emulation/input.yml. Nothing here names a controller.

/**
 * Controllers that carry pairing instructions, normalised for display.
 *
 * @param {Array<object>} controllers  input.yml `controllers` entries.
 * @returns {Array<{ id: string, label: string, mode: string|null, steps: string[], troubleshoot: string|null }>}
 */
export function pairingGuides(controllers) {
  const out = [];
  for (const c of Array.isArray(controllers) ? controllers : []) {
    const steps = Array.isArray(c?.pairing?.steps)
      ? c.pairing.steps.filter((s) => typeof s === 'string' && s.trim())
      : [];
    if (!c?.id || steps.length === 0) continue;
    out.push({
      id: c.id,
      label: c.label || c.id,
      mode: typeof c.pairing.mode === 'string' ? c.pairing.mode : null,
      steps,
      troubleshoot: typeof c.pairing.troubleshoot === 'string' ? c.pairing.troubleshoot : null,
    });
  }
  return out;
}

/** First three octets of a MAC (the vendor OUI), upper-cased, or null. */
function ouiOf(address) {
  const m = /^([0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2})/.exec(String(address || ''));
  return m ? m[1].toUpperCase() : null;
}

/**
 * The `targets` sent with `bt.pair.request` so the garage box knows what to
 * look for and which PIN to answer with. `pairing.name` defaults to the
 * controller's `match` regex; `pairing.mac_prefix` defaults to the OUI of its
 * known `address`.
 *
 * @param {Array<object>} controllers
 * @param {string|null} [onlyId]  restrict to one controller (the one being paired).
 * @returns {Array<{ id: string, label: string, name?: string, macPrefix?: string, pin?: string }>}
 */
export function buildPairTargets(controllers, onlyId = null) {
  const out = [];
  for (const c of Array.isArray(controllers) ? controllers : []) {
    if (!c?.id || (onlyId && c.id !== onlyId)) continue;
    const p = c.pairing || {};
    const t = { id: c.id, label: c.label || c.id };
    const name = p.name || c.match;
    if (typeof name === 'string' && name) t.name = name;
    const macPrefix = p.mac_prefix || ouiOf(c.address);
    if (macPrefix) t.macPrefix = String(macPrefix).toUpperCase();
    if (p.pin != null && String(p.pin) !== '') t.pin = String(p.pin);
    if (t.name || t.macPrefix) out.push(t);
  }
  return out;
}

/**
 * OS-level lifecycle state of one configured controller, from the garage
 * box's `bt_inventory` feed (bonded devices + any connected-but-unbonded one).
 *
 *   ready        bonded, connected and up as an input device
 *   connecting   bonded + connected, input device not up yet
 *   asleep       bonded, not connected (8BitDo sleeps; START wakes it and it reconnects)
 *   unpaired     the pad is dialing in on a bond this box no longer has —
 *                the kernel rejects it until it is paired again
 *   not-paired   no bond at all
 *   unknown      no inventory feed (not on the garage box)
 *
 * @param {object} controller            input.yml entry.
 * @param {Array<object>|null|undefined} btInventory
 * @returns {{ status: string, device: object|null }}
 */
export function controllerOsState(controller, btInventory) {
  if (!Array.isArray(btInventory)) return { status: 'unknown', device: null };
  const want = controller?.address ? String(controller.address).toLowerCase() : null;
  let re = null;
  const pattern = controller?.pairing?.name || controller?.match;
  if (pattern) { try { re = new RegExp(pattern, 'i'); } catch { re = null; } }
  const device = btInventory.find((d) => d && typeof d.address === 'string' && want && d.address.toLowerCase() === want)
    || btInventory.find((d) => d && re && re.test(d.name || ''))
    || null;
  if (!device) return { status: 'not-paired', device: null };
  return { status: deviceOsStatus(device), device };
}

/** Lifecycle of one bt_inventory row: 'unpaired' | 'ready' | 'connecting' | 'asleep'. */
export function deviceOsStatus(device) {
  if (device?.paired === false) return 'unpaired';
  if (device?.connected && device.input !== false) return 'ready';
  if (device?.connected) return 'connecting';
  return 'asleep';
}

/** Shown in the "Add a new device" panel. Generic: true of any Bluetooth input device. */
export const ADD_DEVICE_STEPS = Object.freeze([
  'Switch the device on and put it in pairing mode. On most devices you hold the power or pairing button until a light blinks fast.',
  'If it has a mode button (often marked M), choose the mode you want first. A device can show up differently in each mode.',
  'Keep it close to the garage box, then press Start search. The search runs for up to a minute.',
]);

const INPUT_KINDS = new Set(['gamepad', 'keyboard', 'mouse', 'tablet']);

/**
 * bt_inventory rows that no configured controller claims and that are input
 * devices: a known input kind (from the Icon line), or a device that advertises
 * a HID service (`hid`, which holds while it sleeps). A live kernel input node
 * (`input`) does not count on its own: a speaker's AVRCP remote-control node
 * is one. Speakers and other bonded non-input devices are left out, so nobody
 * forgets them here.
 *
 * @param {Array<object>} controllers  input.yml `controllers` entries.
 * @param {Array<object>|null|undefined} btInventory
 * @returns {Array<object>} inventory rows plus `status` (see deviceOsStatus).
 */
export function otherBtDevices(controllers, btInventory) {
  if (!Array.isArray(btInventory)) return [];
  const claimed = new Set();
  for (const c of Array.isArray(controllers) ? controllers : []) {
    const { device } = controllerOsState(c, btInventory);
    if (device?.address) claimed.add(device.address.toUpperCase());
  }
  return btInventory
    .filter((d) => d && typeof d.address === 'string' && !claimed.has(d.address.toUpperCase()))
    .filter((d) => INPUT_KINDS.has(d.kind) || d.hid === true)
    .map((d) => ({ ...d, status: deviceOsStatus(d) }));
}

const BUSY = new Set(['scanning', 'seen', 'found', 'stale-bond-removed', 'pairing', 'agent', 'retry', 'bonded', 'connecting', 'hid-wait', 'hid-retry', 'warn', 'already-paired']);

const PHASE_TEXT = {
  seen: (n) => `Seen ${n}…`,
  found: (n) => `Found ${n} — pairing…`,
  'stale-bond-removed': (n) => `Clearing an old pairing for ${n}…`,
  pairing: (n) => `Pairing ${n}…`,
  agent: (n) => `Pairing ${n}…`,
  retry: (n) => `Pairing ${n} again (one more try)…`,
  bonded: (n) => `Paired ${n} — connecting…`,
  connecting: (n) => `Connecting ${n}…`,
  'hid-wait': (n) => `Waiting for ${n} to come up as a controller…`,
  'hid-retry': (n) => `Reconnecting ${n} once more…`,
  warn: (n) => `Connecting ${n}…`,
  'already-paired': (n) => `${n} is already paired and connected`,
};

/**
 * What the guide's status line says for a `bt.pair.progress` message.
 *
 * @param {object|null|undefined} pairing  latest progress ({ phase, device, message, paired, reason, durationMs }).
 * @param {'repair'|'add'} [mode]  `add` words everything for any device; anything else keeps the
 *   controller wording of a configured pad's re-pair.
 * @returns {{ busy: boolean, tone: 'idle'|'info'|'ok'|'error', text: string|null, retry: boolean }}
 */
export function pairingStatus(pairing, mode) {
  const phase = pairing?.phase;
  const name = pairing?.device?.name;
  const add = mode === 'add';
  const noun = add ? 'device' : 'controller';
  if (!phase) return { busy: false, tone: 'idle', text: null, retry: false };
  if (BUSY.has(phase)) {
    if (phase === 'scanning') {
      const secs = Math.round((Number(pairing?.durationMs) || 30000) / 1000);
      return { busy: true, tone: 'info', text: `Looking for the ${noun}… (up to ${secs}s)`, retry: false };
    }
    const fmt = PHASE_TEXT[phase] || PHASE_TEXT.pairing;
    return { busy: true, tone: 'info', text: fmt(name || `the ${noun}`), retry: false };
  }
  if (phase === 'paired') {
    return { busy: true, tone: 'ok', text: `Paired ${name || noun} ✓`, retry: false };
  }
  if (phase === 'error') {
    return { busy: !!pairing?.device, tone: 'error', text: `Pairing failed — ${pairing?.message || 'unknown error'}`, retry: !pairing?.device };
  }
  if (phase === 'done') {
    if (pairing?.reason === 'already-paired') {
      const who = pairing.paired?.[0]?.name || 'That controller';
      return { busy: false, tone: 'info', text: `${who} is already connected. To add a different device, use Add a new device.`, retry: false };
    }
    const n = Array.isArray(pairing?.paired) ? pairing.paired.length : 0;
    if (n > 0) {
      const names = pairing.paired.map((d) => d?.name).filter(Boolean).join(', ');
      return { busy: false, tone: 'ok', text: `Paired ${names || `${n} ${noun}${n === 1 ? '' : 's'}`} ✓`, retry: false };
    }
    if (pairing?.reason === 'no-response') {
      return { busy: false, tone: 'error', text: 'The garage box did not answer. Check it is on, then try again.', retry: true };
    }
    if (pairing?.reason === 'no-input') {
      if (add) {
        return {
          busy: false,
          tone: 'error',
          text: 'Paired, but it never came up as an input device. Switch it off and on, then try again.',
          retry: true,
        };
      }
      return {
        busy: false,
        tone: 'error',
        text: 'Paired, but it never came up as a controller. Turn it off and back on with START, then try again.',
        retry: true,
      };
    }
    if (pairing?.reason === 'helper-crashed' || pairing?.reason === 'helper-failed' || pairing?.reason === 'timeout') {
      return { busy: false, tone: 'error', text: 'The pairing service stopped unexpectedly. Try again.', retry: true };
    }
    if (pairing?.reason === 'pair-failed') {
      if (add) {
        return {
          busy: false,
          tone: 'error',
          text: 'Found the device but it would not pair. Switch it off, put it back in pairing mode, and try again.',
          retry: true,
        };
      }
      return {
        busy: false,
        tone: 'error',
        text: 'Found the controller but it would not pair. Turn it off, put it back in pairing mode, and try again.',
        retry: true,
      };
    }
    if (add) {
      return {
        busy: false,
        tone: 'error',
        text: 'No new device found. Check it is in pairing mode (light blinking fast), then try again.',
        retry: true,
      };
    }
    return {
      busy: false,
      tone: 'error',
      text: 'No controller found. Check the LED is blinking fast (that means pairing mode), then try again.',
      retry: true,
    };
  }
  return { busy: false, tone: 'idle', text: null, retry: false };
}
