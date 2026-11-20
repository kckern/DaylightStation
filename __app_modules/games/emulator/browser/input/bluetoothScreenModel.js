// bluetoothScreenModel.js — pure helpers for the Bluetooth screen.
//
// Every device-specific word comes from input.yml (label, pairing steps, wake
// hint, PIN) or from the device itself (its Bluetooth name). Nothing here
// names a device. Rows are keyed by address; the screen shows the last two
// octets only.

const KIND_LABEL = { gamepad: 'Controller', keyboard: 'Keyboard', mouse: 'Mouse', tablet: 'Tablet', remote: 'Remote' };
const UNNAMED = { gamepad: 'Unnamed controller', keyboard: 'Unnamed keyboard', mouse: 'Unnamed mouse', tablet: 'Unnamed tablet', remote: 'Unnamed remote' };
const INPUT_KINDS = new Set(['gamepad', 'keyboard', 'mouse', 'tablet', 'remote']);
const OUTDATED = 'The garage Bluetooth service needs an update.';
const NO_ANSWER = 'The garage Bluetooth service did not answer.';

export function kindLabel(kind) { return KIND_LABEL[kind] || 'Device'; }

export function displayName(device) {
  const n = String(device?.name || '').trim();
  return n || UNNAMED[device?.kind] || 'Unnamed device';
}

export function addressTail(address) {
  const parts = String(address || '').toUpperCase().split(':');
  return parts.length >= 2 ? `…${parts.slice(-2).join(':')}` : '';
}

export function rssiBars(rssi) {
  if (typeof rssi !== 'number') return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -78) return 2;
  if (rssi >= -90) return 1;
  return 0;
}

export function isInputDevice(d) {
  return INPUT_KINDS.has(d?.kind) || d?.hid === true || d?.gamepad === true;
}

function regexOrNull(pattern) {
  if (!pattern) return null;
  try { return new RegExp(pattern, 'i'); } catch { return null; }
}

function ouiOf(address) {
  const m = /^([0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2})/i.exec(String(address || ''));
  return m ? m[1].toUpperCase() : null;
}

/** The input.yml controller a Bluetooth device is: exact address, then Bluetooth name, then vendor prefix. */
export function matchController(device, controllers) {
  const list = Array.isArray(controllers) ? controllers : [];
  const addr = String(device?.address || '').toUpperCase();
  if (!addr) return null;
  const byAddr = list.find((c) => c?.address && String(c.address).toUpperCase() === addr);
  if (byAddr) return byAddr;
  const name = String(device?.name || '');
  const byName = name ? list.find((c) => regexOrNull(c?.pairing?.name || c?.match)?.test(name)) : null;
  if (byName) return byName;
  return list.find((c) => {
    const prefix = String(c?.pairing?.mac_prefix || ouiOf(c?.address) || '').toUpperCase();
    return prefix && addr.startsWith(prefix);
  }) || null;
}

function pinOf(c) {
  return c?.pairing?.pin != null && String(c.pairing.pin) !== '' ? String(c.pairing.pin) : null;
}

/** 'connected' | 'connecting' | 'asleep' | 'not-connected' | 'needs-pairing'. */
export function rowStatus(d) {
  if (d?.paired === false) return 'needs-pairing';
  if (d?.connected && d.input !== false) return 'connected';
  if (d?.connected) return 'connecting';
  return d?.kind === 'gamepad' || d?.gamepad ? 'asleep' : 'not-connected';
}

const STATUS_TEXT = {
  connected: 'Connected', connecting: 'Connecting…', asleep: 'Asleep',
  'not-connected': 'Not connected', 'needs-pairing': 'Needs pairing again',
};

export function statusText(status, battery) {
  const t = STATUS_TEXT[status] || STATUS_TEXT['not-connected'];
  return status === 'connected' && Number.isFinite(battery) ? `${t} · ${battery}%` : t;
}

/** Paired list rows from bt_inventory: input devices, and anything input.yml names. */
export function pairedRows(inventory, controllers) {
  if (!Array.isArray(inventory)) return [];
  return inventory
    .filter((d) => d && typeof d.address === 'string')
    .map((d) => ({ d, c: matchController(d, controllers) }))
    .filter(({ d, c }) => c || isInputDevice(d))
    .map(({ d, c }) => {
      const status = rowStatus(d);
      const kind = d.kind || (d.gamepad ? 'gamepad' : null);
      return {
        address: d.address.toUpperCase(),
        name: c?.label || displayName(d),
        kind,
        typeLabel: kindLabel(kind),
        tail: addressTail(d.address),
        status,
        statusText: statusText(status, d.battery),
        controllerId: c?.id || null,
        pin: pinOf(c),
        wakeHint: status === 'asleep' && typeof c?.pairing?.wake === 'string' ? c.pairing.wake : null,
        bonded: d.paired !== false,
      };
    });
}

/** "How to pair <label>" for configured controllers with steps that are not paired. Placeholders without steps never show. */
export function pairHints(controllers, inventory) {
  const rows = Array.isArray(inventory) ? inventory : [];
  return (Array.isArray(controllers) ? controllers : [])
    .map((c) => ({ c, steps: Array.isArray(c?.pairing?.steps) ? c.pairing.steps.filter((s) => typeof s === 'string' && s.trim()) : [] }))
    .filter(({ c, steps }) => c?.id && steps.length > 0)
    .filter(({ c }) => !rows.some((d) => d?.paired !== false && matchController(d, [c])))
    .map(({ c, steps }) => ({
      id: c.id,
      label: c.label || c.id,
      mode: typeof c.pairing.mode === 'string' ? c.pairing.mode : null,
      steps,
      troubleshoot: typeof c.pairing.troubleshoot === 'string' ? c.pairing.troubleshoot : null,
    }));
}

/** Nearby rows: input devices unless showAll; a stable order (highlighted, then name) so the list does not jump. */
export function nearbyRows(devices, { showAll = false, inventory, controllers, highlightId = null } = {}) {
  const paired = new Set((Array.isArray(inventory) ? inventory : [])
    .filter((d) => d?.address && d.paired !== false).map((d) => d.address.toUpperCase()));
  return (Array.isArray(devices) ? devices : [])
    .filter((d) => d?.address && (showAll || isInputDevice(d)))
    .map((d) => {
      const c = matchController(d, controllers);
      const address = d.address.toUpperCase();
      return {
        address,
        name: c?.label || displayName(d),
        kind: d.kind || null,
        typeLabel: kindLabel(d.kind),
        tail: addressTail(address),
        bars: rssiBars(d.rssi),
        paired: d.paired === true || paired.has(address),
        controllerId: c?.id || null,
        pin: pinOf(c),
        highlight: !!highlightId && c?.id === highlightId,
      };
    })
    .sort((a, b) => Number(b.highlight) - Number(a.highlight) || a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

export function hiddenNearbyCount(devices) {
  return (Array.isArray(devices) ? devices : []).filter((d) => d?.address && !isInputDevice(d)).length;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SEARCHING = new Set(['scanning', 'seen']);
const PAIRING = new Set(['found', 'stale-bond-removed', 'pairing', 'agent', 'retry', 'bonded']);
const CONNECTING = new Set(['connecting', 'hid-wait', 'hid-retry', 'warn']);
const ERROR_TEXT = {
  'auth-failed': (w) => `${w} refused the pairing.`,
  'auth-canceled': (w) => `The pairing was cancelled on ${w}.`,
  timeout: (w) => `${w} stopped answering.`,
  unreachable: (w) => `${w} could not be reached.`,
  'already-paired': (w) => `${w} is already paired.`,
  busy: () => 'Bluetooth was busy.',
  'no-input': (w) => `${w} paired, but no presses came through.`,
};
const NEXT = {
  'no-input': 'Switch it off and on, put it in pairing mode, then search again.',
  'already-paired': 'Find it under Paired devices, or Forget it there and pair it again.',
  busy: 'Wait a moment, then search again.',
};
const DEFAULT_NEXT = 'Put it back in pairing mode, then search again.';
const view = (busy, tone, text, next = null, passkey = null) => ({ busy, tone, text, next, passkey });

function failure(code, who, busy = false) {
  const t = ERROR_TEXT[code];
  return view(busy, 'error', cap(t ? t(who) : `${who} did not pair.`), NEXT[code] || DEFAULT_NEXT);
}

/**
 * What the pairing view says for the latest `bt.pair.progress` of the
 * picked device. Never shows `message` (raw BlueZ text): that is logged.
 */
export function pairView(pairing, name) {
  const who = name || pairing?.device?.name || 'the device';
  const phase = pairing?.phase;
  if (!phase) return view(false, 'idle', null);
  if (pairing.satelliteOutdated) return view(false, 'error', OUTDATED);
  if (phase === 'passkey' || phase === 'pincode') {
    const code = String(pairing.passkey || '');
    return view(true, 'action', `Type ${code} on ${who}, then press Enter.`, null, code);
  }
  if (SEARCHING.has(phase)) return view(true, 'info', `Looking for ${who}…`, 'Put it in pairing mode now if it is not already.');
  if (PAIRING.has(phase)) return view(true, 'info', `Pairing ${who}…`);
  if (CONNECTING.has(phase)) return view(true, 'info', `Connecting ${who}…`);
  if (phase === 'paired' || phase === 'already-paired') return view(false, 'ok', 'Connected.');
  // An error line is always followed by the window's one `done`: say what went
  // wrong now, but keep the screen busy (no Search again yet) until it ends.
  if (phase === 'error') return failure(pairing.code, who, true);
  if (phase === 'done') {
    if ((pairing.paired?.length || 0) > 0 || pairing.reason === 'already-paired') return view(false, 'ok', 'Connected.');
    if (pairing.reason === 'unsupported-mode') return view(false, 'error', OUTDATED);
    // Another pairing window was already open on the satellite.
    if (pairing.reason === 'busy') return view(false, 'error', 'Already pairing another device — wait for it to finish.');
    if (pairing.reason === 'invalid-address') return view(false, 'error', cap(`${who} could not be paired from here.`), 'Search again and pick it.');
    if (pairing.reason === 'none-found') return view(false, 'error', cap(`${who} did not show up.`), 'Put it in pairing mode and keep it close, then search again.');
    if (pairing.reason === 'no-response') return view(false, 'error', NO_ANSWER, 'Search again in a minute.');
    if (['helper-crashed', 'helper-failed', 'timeout'].includes(pairing.reason)) return view(false, 'error', 'Bluetooth stopped unexpectedly.', 'Try again.');
    return failure(pairing.code || (pairing.reason === 'no-input' ? 'no-input' : null), who);
  }
  return view(false, 'idle', null);
}

/** The search's status line, with the countdown. */
export function scanView(scan, now = Date.now()) {
  if (!scan) return { active: false, tone: 'idle', text: null };
  if (scan.phase === 'starting') return { active: true, tone: 'info', text: 'Starting the search…' };
  if (scan.phase === 'stopping') return { active: true, tone: 'info', text: 'Stopping…' };
  if (scan.phase === 'scanning') {
    const s = scan.endsAt ? Math.max(0, Math.ceil((scan.endsAt - now) / 1000)) : null;
    return { active: true, tone: 'info', text: s == null ? 'Searching…' : `Searching… ${s} s` };
  }
  const ERR = {
    'satellite-outdated': OUTDATED,
    'no-response': `${NO_ANSWER} Search again in a minute.`,
    busy: 'Bluetooth is busy pairing. Search again in a moment.',
    'helper-failed': 'The search stopped unexpectedly. Search again.',
    'helper-crashed': 'The search stopped unexpectedly. Search again.',
  };
  return ERR[scan.reason]
    ? { active: false, tone: 'error', text: ERR[scan.reason] }
    : { active: false, tone: 'idle', text: 'Search ended.' };
}

export function forgetText(result) {
  if (!result?.address) return null;
  if (result.success) return 'Forgotten. To use it again, search for it and pick it.';
  if (result.error === 'pairing-in-progress') return 'Bluetooth is busy pairing. Try again when it finishes.';
  return 'Could not forget it. Try again.';
}
