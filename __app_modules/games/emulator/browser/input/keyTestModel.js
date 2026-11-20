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

export function keyLabel(event) {
  const k = normalizeKey(event?.key);
  if (!k || k === 'Unidentified') return event?.code ? `Key ${event.code}` : 'Unknown key';
  return k;
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
    const padId = pad.id || `Pad ${pad.index + 1}`;
    buttons.forEach((on, i) => { if (on && !before.buttons[i]) events.push({ padId, input: `Button ${i}` }); });
    axes.forEach((d, i) => { if (d !== 0 && d !== before.axes[i]) events.push({ padId, input: `Stick axis ${i} ${d < 0 ? '−' : '+'}` }); });
  }
  return { events, snapshot };
}

export function testVerdict({ keys = [], padInputs = 0, gameKeys = new Set() }) {
  if (padInputs > 0) return { id: 'controller', tone: 'ok', text: 'Games can use this as a controller.' };
  const usable = [...new Set(keys.filter((k) => gameKeys.has(k)))];
  if (usable.length) return { id: 'game-keys', tone: 'ok', text: `Games can use these keys: ${usable.join(', ')}.` };
  if (keys.length) return { id: 'other-keys', tone: 'warn', text: "Games can't use these keys yet." };
  return { id: 'nothing', tone: 'idle', text: null };
}
