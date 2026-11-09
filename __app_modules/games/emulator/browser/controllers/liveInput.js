// liveInput.js — pure reads of navigator.getGamepads() for the Controllers
// screen's live-input check ("mash the buttons, see it light up"). No I/O.

/** A press keeps its lamp lit this long, so a quick tap is still visible from the sofa. */
export const LIT_MS = 600;

const DEADZONE = 0.5;

/**
 * Standard Gamepad mapping, named by POSITION, not by printed letter: 8BitDo
 * and Nintendo-style pads print A on the right, Xbox-style on the bottom, so a
 * letter would be wrong for half the pads in the house.
 */
export const BUTTON_NAMES = [
  'bottom face button', 'right face button', 'left face button', 'top face button',
  'L', 'R', 'L2', 'R2', 'Select', 'Start', 'left stick press', 'right stick press',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home',
];

/** The TV remote can register as a gamepad; it is never a controller under test. */
export const isRemote = (id) => /remote/i.test(String(id || ''));

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * One entry per live, non-remote gamepad: which buttons are down and where the
 * sticks point. `active` is any button pressed or any axis past the deadzone.
 */
export function readPads(raw) {
  const out = [];
  for (const gp of raw || []) {
    if (!gp || gp.connected === false || isRemote(gp.id)) continue;
    const pressed = (gp.buttons || []).map((b) => Boolean(b && (b.pressed || b.value > 0.5)));
    const axes = (gp.axes || []).map((a) => (Math.abs(a) > DEADZONE ? Math.sign(a) : 0));
    out.push({
      index: gp.index,
      id: gp.id,
      name: displayName(gp.id),
      pressed,
      axes,
      active: pressed.some(Boolean) || axes.some((a) => a !== 0),
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** "8Bitdo SN30 Pro (STANDARD GAMEPAD Vendor: 2dc8 Product: 6101)" → "8Bitdo SN30 Pro". */
export function displayName(id) {
  const name = String(id || '').replace(/\s*\(.*\)\s*$/, '').trim();
  return name || 'Controller';
}

/** Changes only when what is pressed changes — the hook re-renders on this, not every frame. */
export function padsSignature(pads) {
  return pads.map((p) => `${p.index}:${p.id}:${p.pressed.map(Number).join('')}:${p.axes.join(',')}`).join('|');
}

/** Words for what is down right now, for the "I'm here" line. */
export function describePress(pad) {
  const names = pad.pressed.map((on, i) => (on ? BUTTON_NAMES[i] || `button ${i}` : null)).filter(Boolean);
  const [x, y] = pad.axes;
  if (x || y) names.push(`stick ${[y < 0 ? 'up' : y > 0 ? 'down' : '', x < 0 ? 'left' : x > 0 ? 'right' : ''].filter(Boolean).join('-')}`);
  return names.join(' + ');
}

/**
 * Which gamepad belongs to which Bluetooth row. The browser exposes no address,
 * only a name, so a pad is attributed only when exactly ONE connected row
 * carries that name; with two identical pads connected the rows stay unlit and
 * the live-input panel (Player 1, Player 2) is what tells them apart.
 *
 * @returns {Map<string, number>} Bluetooth address → gamepad index
 */
export function attributePads(pads, connectedDevices) {
  const map = new Map();
  for (const pad of pads) {
    const name = norm(pad.name);
    const rows = connectedDevices.filter((d) => {
      const n = norm(d.name);
      return n && (name.includes(n) || n.includes(name));
    });
    if (rows.length === 1) map.set(rows[0].address, pad.index);
  }
  return map;
}
