// keyTestModel.js — pure helpers for the Bluetooth screen's key test.
// Which keys games use comes from input.yml's `keyboard:` block.

export function normalizeKey(key) {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  const k = String(key ?? '');
  return k.length === 1 ? k.toLowerCase() : k;
}

export function gameKeySet(keyboardMap) {
  const out = new Set();
  if (keyboardMap && typeof keyboardMap === 'object') {
    for (const v of Object.values(keyboardMap)) if (typeof v === 'string' && v) out.add(normalizeKey(v));
  }
  return out;
}

const KEY_NAMES = {
  ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow',
  AudioVolumeUp: 'Volume up', AudioVolumeDown: 'Volume down', AudioVolumeMute: 'Mute',
  MediaPlayPause: 'Play/pause', MediaPlay: 'Play', MediaPause: 'Pause', MediaStop: 'Stop',
  MediaTrackNext: 'Next track', MediaTrackPrevious: 'Previous track',
  MediaFastForward: 'Fast forward', MediaRewind: 'Rewind',
  BrowserBack: 'Back', GoBack: 'Back', ContextMenu: 'Menu',
  // Remote controls decoded by the garage box (bt.remote.key, not browser keys).
  ButtonA: 'A button', ButtonB: 'B button', ButtonC: 'C button', ButtonD: 'D button',
  TriggerCircle: 'Circle trigger', TriggerBack: 'Back trigger',
  StickUp: 'Stick up', StickDown: 'Stick down', StickLeft: 'Stick left', StickRight: 'Stick right',
};

/** A short, plain name for a normalized key ('x' → 'X', 'AudioVolumeUp' → 'Volume up'). */
export function keyName(k) {
  if (KEY_NAMES[k]) return KEY_NAMES[k];
  return k.length === 1 ? k.toUpperCase() : k;
}

export function keyLabel(event) {
  const k = normalizeKey(event?.key);
  if (!k || k === 'Unidentified') return event?.code ? `Key ${event.code}` : 'Unknown key';
  return keyName(k);
}

// Standard-mapping gamepad buttons named in generic terms only.
const PAD_BUTTONS = { 0: 'A', 1: 'B', 12: 'D-pad up', 13: 'D-pad down', 14: 'D-pad left', 15: 'D-pad right' };
const STICK = { 0: ['Stick left', 'Stick right'], 1: ['Stick up', 'Stick down'] };

/** A browser pad id without its vendor/product suffix or hex prefix, kept short. */
export function shortPadName(id, index = 0) {
  let s = String(id || '').replace(/\s*\(.*\)\s*$/, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim();
  if (!s) return `Pad ${index + 1}`;
  if (s.length > 24) s = `${s.slice(0, 23).trimEnd()}…`;
  return s;
}

const AXIS_ON = 0.5;
const direction = (v) => (v <= -AXIS_ON ? -1 : v >= AXIS_ON ? 1 : 0);

/**
 * New presses since the last snapshot, per pad. A pad seen for the first time
 * records what it holds without reporting it.
 * @returns {{ events: Array<{ padId: string, input: string }>, snapshot: Map }}
 */
export function padChanges(prev, pads) {
  const snapshot = new Map();
  const events = [];
  for (const pad of pads || []) {
    if (!pad) continue;
    const key = String(pad.index);
    const buttons = (pad.buttons || []).map((b) => !!(b && (b.pressed || b.value > 0.5)));
    const axes = (pad.axes || []).map((a) => direction(Number(a) || 0));
    snapshot.set(key, { buttons, axes });
    const before = prev?.get(key);
    if (!before) continue;
    const padId = shortPadName(pad.id, pad.index);
    buttons.forEach((on, i) => { if (on && !before.buttons[i]) events.push({ padId, input: PAD_BUTTONS[i] || `Button ${i}` }); });
    axes.forEach((d, i) => {
      if (d === 0 || d === before.axes[i]) return;
      events.push({ padId, input: STICK[i] ? STICK[i][d < 0 ? 0 : 1] : `Stick axis ${i} ${d < 0 ? '−' : '+'}` });
    });
  }
  return { events, snapshot };
}

export function testVerdict({ keys = [], padInputs = 0, gameKeys = new Set() }) {
  if (padInputs > 0) return { id: 'controller', tone: 'ok', text: 'Games can use this as a controller.' };
  const usable = [...new Set(keys.filter((k) => gameKeys.has(k)))];
  if (usable.length) return { id: 'game-keys', tone: 'ok', text: `Games can use these keys: ${usable.map(keyName).join(', ')}.` };
  if (keys.length) return { id: 'other-keys', tone: 'warn', text: "Games can't use these keys yet." };
  return { id: 'nothing', tone: 'idle', text: null };
}

/**
 * Which remote a key came from. The browser's KeyboardEvent has no device
 * identity, so two remotes of the same model look the same; the garage box
 * reads each remote from the kernel and sends `bt.remote.key` tagged with its
 * Bluetooth address. Both copies of one press arrive (nothing is grabbed), in
 * either order. This pairs them up:
 *  - a tagged press from `address` counts (onCount(key));
 *  - a tagged press from another remote is shown, not counted (onOther);
 *  - a browser key with no tagged twin within `windowMs` counts — a device the
 *    garage box does not read (USB keypad, an old satellite) still tests.
 * `browser()` returns true while that key's fate is pending.
 */
export function createKeyAttributor({ address, windowMs = 400, onCount, onOther, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const want = String(address || '').toUpperCase();
  const pendingBrowser = []; // { key, at, timer }
  const recentTagged = [];   // { key, at }
  const prune = (list) => { const t = now(); while (list.length && t - list[0].at > windowMs) list.shift(); };
  return {
    browser(rawKey) {
      const key = normalizeKey(rawKey);
      prune(recentTagged);
      const twin = recentTagged.findIndex((r) => r.key === key);
      if (twin >= 0) { recentTagged.splice(twin, 1); return false; }
      const entry = { key, at: now(), timer: null };
      entry.timer = setTimer(() => {
        const i = pendingBrowser.indexOf(entry);
        if (i >= 0) { pendingBrowser.splice(i, 1); onCount?.(key, 'browser'); }
      }, windowMs);
      pendingBrowser.push(entry);
      return true;
    },
    tagged({ address: from, key: rawKey, state } = {}) {
      if (state && state !== 'down') return;
      const key = normalizeKey(rawKey);
      const i = pendingBrowser.findIndex((p) => p.key === key);
      if (i >= 0) { clearTimer(pendingBrowser[i].timer); pendingBrowser.splice(i, 1); }
      else recentTagged.push({ key, at: now() });
      if (String(from || '').toUpperCase() === want) onCount?.(key, 'remote');
      else onOther?.(key, String(from || '').toUpperCase());
    },
    stop() { pendingBrowser.forEach((p) => clearTimer(p.timer)); pendingBrowser.length = 0; },
  };
}
