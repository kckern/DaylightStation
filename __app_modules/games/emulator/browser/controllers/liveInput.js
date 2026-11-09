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

/**
 * Not a controller under test, even though the browser lists it as a gamepad:
 * the TV remote, and (seen on the Shield, 2026-11-07) the living room's
 * "wireless wireless 2.4G Mouse" dongle at slot 0. Excluding them also keeps
 * their presses from tripping the key guard and locking out navigation.
 */
export const isRemote = (id) => /remote|mouse|keyboard|keypad|touchpad|trackball|presenter/i.test(String(id || ''));

/** Same test as the screen host's gamepadFiltering.isPlausibleGamepad (a private module there). */
const plausible = (gp) => !isRemote(gp.id) && (gp.buttons?.length || 0) >= 4 && (gp.axes?.length || 0) >= 2;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim(); // '+' is part of a model name (SN30 Pro+)

/**
 * One entry per live, non-remote gamepad: which buttons are down and where the
 * sticks point. `active` is any button pressed or any axis past the deadzone.
 */
export function readPads(raw) {
  const out = [];
  for (const gp of raw || []) {
    if (!gp || gp.connected === false || !plausible(gp)) continue;
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
  return numberPlayers(out.sort((a, b) => a.index - b.index));
}

/** "Player N" counts shown controllers only, so a skipped dongle or twin never makes the only pad "Player 2". */
export const numberPlayers = (pads) => pads.map((pad, i) => ({ ...pad, player: i + 1 }));

const stateKey = (p) => `${p.pressed.map(Number).join('')}:${p.axes.join(',')}`;

/**
 * Chromium on the Shield can enumerate ONE pad at two indices with mirrored
 * state (logged 2026-11-07); the house also owns several identical SN30 Pros.
 * Tell them apart by behaviour: same-id pads pressed in exact lockstep are one
 * device (hide the higher index); a same-id pad ever active on its own is real.
 * `memory` ({ twins:Set, real:Set } of indices) persists across frames.
 */
export function dropTwins(pads, memory) {
  const byId = new Map();
  for (const p of pads) byId.set(p.id, [...(byId.get(p.id) || []), p]);
  for (const group of byId.values()) {
    if (group.length < 2) continue;
    const active = group.filter((p) => p.active);
    if (!active.length) continue;
    const mirrored = active.length === group.length && active.every((p) => stateKey(p) === stateKey(active[0]));
    for (const p of group.slice(1)) {
      if (mirrored && !memory.real.has(p.index)) memory.twins.add(p.index);
      if (!mirrored && p.active) { memory.real.add(p.index); memory.twins.delete(p.index); }
    }
  }
  return numberPlayers(pads.filter((p) => !memory.twins.has(p.index)));
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
    // Whole-name match: "SN30 Pro" must not claim an "SN30 Pro+" row.
    const rows = connectedDevices.filter((d) => norm(d.name) === name);
    const twins = pads.filter((p) => norm(p.name) === name);
    if (rows.length === 1 && twins.length === 1) map.set(rows[0].address, pad.index);
  }
  return map;
}
