// deviceFaceModel.js — the "device face" on the Bluetooth screen: a device's
// controls as keycaps, laid out like the physical device.
//
// Everything comes from data. A remote's controls are input.yml `buttons:`
// (physical control → key name) and its optional `layout:` hint; a remote
// with no entry gets keycaps from the keys it sends, in first-seen order; a
// browser gamepad gets the standard-mapping face. Nothing here names a device.
//
// A remote whose entry has `positions:` (what the rider presses → physical
// button, for a remote mounted at an angle) is drawn AS MOUNTED: a five-key
// cross from the rider's view, each keycap named by its position, the printed
// button's name small under it.
//
// Face: { source, layout, by, caps: [{ id, slot, key, legend, printed?, role }] }
//   layout  'cross' | 'row' | 'stick-pad' | 'grid' | 'pad'
//   by      what a saved action is keyed by: 'position' (cross) or 'key'
//   slot    that key for this cap: the position, or the key name
//   role    where a cap sits: cross/stick-pad 'up' | 'down' | 'left' | 'right' (+ cross 'center',
//           stick-pad 'top' | 'grid'); pad 'shoulder' | 'meta' | 'face-top' | 'face-left' | 'face-right' | 'face-bottom' and the D-pad directions
import { keyName, normalizeKey } from './keyTestModel.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'];
const POSITIONS = ['up', 'left', 'center', 'right', 'down'];
const POSITION_LEGEND = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', center: 'Centre' };

/**
 * A remote's `positions:` resolved through its `buttons:`:
 * [{ position, button, key }] for each position whose button sends a key.
 * Empty when the entry has no usable `positions:`.
 */
export function remotePositions(controller) {
  const p = controller?.positions;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
  const keys = new Map(inventoryButtons(controller).map((b) => [b.control, b.key]));
  return POSITIONS
    .filter((pos) => typeof p[pos] === 'string' && keys.has(p[pos]))
    .map((pos) => ({ position: pos, button: p[pos], key: keys.get(p[pos]) }));
}

/** The rider position a key comes from on this remote, or null. */
export function positionOfKey(controller, key) {
  const k = normalizeKey(key);
  return remotePositions(controller).find((p) => p.key === k)?.position || null;
}

/** 'circle_trigger' → 'Circle trigger'; 'stickUp' → 'Stick up'. */
export function humanizeControl(name) {
  const words = String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (!words.length) return '';
  const s = words.join(' ');
  return s.length === 1 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1);
}

function directionOf(control, key) {
  for (const text of [control, key]) {
    const m = /(?:^|[_\s-]|[a-z])(up|down|left|right)$/i.exec(String(text || ''));
    if (m) return m[1].toLowerCase();
  }
  return null;
}

const isTrigger = (control, key) => /trigger|shoulder|bumper/i.test(`${control} ${key}`);

/** input.yml `buttons:` as [{ control, key }] in file order; non-string keys dropped. */
export function inventoryButtons(controller) {
  const b = controller?.buttons;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return [];
  return Object.entries(b)
    .filter(([control, key]) => control && typeof key === 'string' && key.trim())
    .map(([control, key]) => ({ control, key: normalizeKey(key.trim()) }));
}

function stickPadCaps(buttons) {
  const caps = buttons.map(({ control, key }) => {
    const dir = directionOf(control, key);
    if (dir) return { id: key, key, legend: humanizeControl(dir), role: dir };
    // The top row is the triggers: the legend drops the word.
    if (isTrigger(control, key)) {
      const short = String(control).replace(/[_\s-]*(trigger|shoulder|bumper)[_\s-]*/i, ' ').trim();
      return { id: key, key, legend: humanizeControl(short || control), role: 'top' };
    }
    return { id: key, key, legend: humanizeControl(control), role: 'grid' };
  });
  // One cap per direction: a second "up" is just another button.
  const seen = new Set();
  return caps.map((c) => {
    if (!DIRECTIONS.includes(c.role)) return c;
    if (seen.has(c.role)) return { ...c, role: 'grid' };
    seen.add(c.role);
    return c;
  });
}

/**
 * The face of a remote: from input.yml when it lists `buttons:`, else from the
 * keys it has sent this visit. `layout:` 'row' and 'stick-pad' are honoured;
 * anything else is a wrapped grid in `buttons:` order.
 */
export function remoteFace(controller, seenKeys = []) {
  const positions = remotePositions(controller);
  if (positions.length) {
    // `toward:` { front, rear }: which positions face the bike's front and rear.
    const t = controller?.toward && typeof controller.toward === 'object' ? controller.toward : {};
    const toward = Object.fromEntries(['front', 'rear']
      .filter((side) => POSITIONS.includes(t[side]) && t[side] !== 'center')
      .map((side) => [t[side], side]));
    return {
      source: 'inventory', layout: 'cross', by: 'position', toward,
      caps: positions.map(({ position, button, key }) => ({
        id: position, slot: position, key, legend: POSITION_LEGEND[position], printed: humanizeControl(button), role: position,
      })),
    };
  }
  const buttons = inventoryButtons(controller);
  if (buttons.length) {
    // Two controls sending the same key are one keycap to us: keep the first.
    const unique = buttons.filter((b, i) => buttons.findIndex((o) => o.key === b.key) === i);
    const hint = typeof controller?.layout === 'string' ? controller.layout.trim().toLowerCase() : null;
    if (hint === 'stick-pad') {
      const caps = stickPadCaps(unique);
      if (caps.some((c) => DIRECTIONS.includes(c.role))) return { source: 'inventory', layout: 'stick-pad', by: 'key', caps: caps.map((c) => ({ ...c, slot: c.key })) };
    }
    const layout = hint === 'row' ? 'row' : 'grid';
    return { source: 'inventory', layout, by: 'key', caps: unique.map(({ control, key }) => ({ id: key, slot: key, key, legend: humanizeControl(control), role: layout })) };
  }
  const keys = [...new Set((seenKeys || []).map(normalizeKey).filter(Boolean))];
  return { source: 'seen', layout: 'grid', by: 'key', caps: keys.map((key) => ({ id: key, slot: key, key, legend: keyName(key), role: 'grid' })) };
}

// Browser Gamepad API standard mapping, in generic words.
const PAD_CAPS = [
  { index: 4, legend: 'L', role: 'shoulder' }, { index: 6, legend: 'L2', role: 'shoulder' },
  { index: 7, legend: 'R2', role: 'shoulder' }, { index: 5, legend: 'R', role: 'shoulder' },
  { index: 12, legend: 'Up', role: 'up' }, { index: 13, legend: 'Down', role: 'down' },
  { index: 14, legend: 'Left', role: 'left' }, { index: 15, legend: 'Right', role: 'right' },
  { index: 8, legend: 'Select', role: 'meta' }, { index: 9, legend: 'Start', role: 'meta' },
  { index: 3, legend: 'Y', role: 'face-top' }, { index: 2, legend: 'X', role: 'face-left' },
  { index: 1, legend: 'B', role: 'face-right' }, { index: 0, legend: 'A', role: 'face-bottom' },
];
// What a pad button does on these screens (useArcadeInput: A or Start select, B back).
const PAD_ACTION = { 0: 'Select', 1: 'Back', 9: 'Select', 12: 'Up', 13: 'Down', 14: 'Left', 15: 'Right' };

export function padFace() {
  return {
    source: 'gamepad',
    layout: 'pad',
    by: null,
    caps: PAD_CAPS.map((c) => ({ id: `pad:${c.index}`, key: `pad:${c.index}`, legend: c.legend, role: c.role, action: PAD_ACTION[c.index] || '' })),
  };
}

const AXIS_ON = 0.5;
/**
 * Which pad caps are held right now, over every connected pad. The cross also
 * lights from the left stick: some pads report their D-pad as the stick.
 */
export function padHeld(pads) {
  const held = new Set();
  for (const pad of pads || []) {
    if (!pad) continue;
    (pad.buttons || []).forEach((b, i) => { if (b && (b.pressed || b.value > 0.5)) held.add(`pad:${i}`); });
    const [x, y] = pad.axes || [];
    if (x <= -AXIS_ON) held.add('pad:14');
    if (x >= AXIS_ON) held.add('pad:15');
    if (y <= -AXIS_ON) held.add('pad:12');
    if (y >= AXIS_ON) held.add('pad:13');
  }
  return held;
}

/** The saved map a face reads: the remote's `positions` for a cross, else its `buttons`. */
export function savedFor(entry, face) {
  if (!entry || !face?.by) return null;
  return (face.by === 'position' ? entry.positions : entry.buttons) || null;
}

/** The plain-words action under a keycap (by its slot): the saved one, else "Not set". */
export function capActionLabel(cap, savedButtons, groups) {
  if (typeof cap?.action === 'string') return cap.action;
  const id = savedButtons?.[cap?.slot ?? cap?.key];
  if (!id) return 'Not set';
  for (const g of groups || []) {
    const a = (g.actions || []).find((x) => x.id === id);
    if (a) return a.label;
  }
  return 'Not set';
}

/** The kind of face a paired row gets. */
export function faceKind(row, controller) {
  if (row?.kind === 'gamepad' || (controller && controller.kind !== 'remote' && !controller.buttons && row?.kind !== 'keyboard')) return 'pad';
  return 'remote';
}
