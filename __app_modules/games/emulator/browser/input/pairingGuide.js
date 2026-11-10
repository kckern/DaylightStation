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
  if (device.paired === false) return { status: 'unpaired', device };
  if (device.connected && device.input !== false) return { status: 'ready', device };
  if (device.connected) return { status: 'connecting', device };
  return { status: 'asleep', device };
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
 * @returns {{ busy: boolean, tone: 'idle'|'info'|'ok'|'error', text: string|null, retry: boolean }}
 */
export function pairingStatus(pairing) {
  const phase = pairing?.phase;
  const name = pairing?.device?.name;
  if (!phase) return { busy: false, tone: 'idle', text: null, retry: false };
  if (BUSY.has(phase)) {
    if (phase === 'scanning') {
      const secs = Math.round((Number(pairing?.durationMs) || 30000) / 1000);
      return { busy: true, tone: 'info', text: `Looking for the controller… (up to ${secs}s)`, retry: false };
    }
    const fmt = PHASE_TEXT[phase] || PHASE_TEXT.pairing;
    return { busy: true, tone: 'info', text: fmt(name || 'the controller'), retry: false };
  }
  if (phase === 'paired') {
    return { busy: true, tone: 'ok', text: `Paired ${name || 'controller'} ✓`, retry: false };
  }
  if (phase === 'error') {
    return { busy: !!pairing?.device, tone: 'error', text: `Pairing failed — ${pairing?.message || 'unknown error'}`, retry: !pairing?.device };
  }
  if (phase === 'done') {
    const n = Array.isArray(pairing?.paired) ? pairing.paired.length : 0;
    if (n > 0) {
      const names = pairing.paired.map((d) => d?.name).filter(Boolean).join(', ');
      return { busy: false, tone: 'ok', text: `Paired ${names || `${n} controller${n === 1 ? '' : 's'}`} ✓`, retry: false };
    }
    if (pairing?.reason === 'no-response') {
      return { busy: false, tone: 'error', text: 'The garage box did not answer. Check it is on, then try again.', retry: true };
    }
    if (pairing?.reason === 'no-input') {
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
      return {
        busy: false,
        tone: 'error',
        text: 'Found the controller but it would not pair. Turn it off, put it back in pairing mode, and try again.',
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
