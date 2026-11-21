// remoteButtonActions.mjs — what a Bluetooth remote's button can be set to do
// on the garage fitness screen, and the shape of one remote's saved buttons.
// Shared by the server (validation before a save) and the browser (the
// Bluetooth screen's chips, the runtime that performs a press).
//
// A remote's buttons are saved one of two ways:
//  - `positions`: by where the rider presses (up/down/left/right/center), for
//    a remote whose input.yml entry has `positions:` (rider position →
//    physical button). Two remotes mounted at different angles send different
//    keys for the same rider direction; by position they map alike.
//  - `buttons`: by the key name the garage box reports for the press
//    (`bt.remote.key` `key`, e.g. MediaPlayPause, ButtonA), for every other
//    remote. The key is what arrives, so a remote with no input.yml entry can
//    be set up too.

export const REMOTE_BUTTON_ACTION_GROUPS = Object.freeze([
  Object.freeze({
    id: 'playback',
    label: 'Playback',
    actions: Object.freeze([
      Object.freeze({ id: 'play-pause', label: 'Play/pause' }),
      Object.freeze({ id: 'next', label: 'Next' }),
      Object.freeze({ id: 'previous', label: 'Previous' }),
      Object.freeze({ id: 'volume-up', label: 'Volume up' }),
      Object.freeze({ id: 'volume-down', label: 'Volume down' }),
    ]),
  }),
  Object.freeze({
    id: 'navigate',
    label: 'Navigate',
    actions: Object.freeze([
      Object.freeze({ id: 'up', label: 'Up' }),
      Object.freeze({ id: 'down', label: 'Down' }),
      Object.freeze({ id: 'left', label: 'Left' }),
      Object.freeze({ id: 'right', label: 'Right' }),
      Object.freeze({ id: 'select', label: 'Select' }),
      Object.freeze({ id: 'back', label: 'Back' }),
    ]),
  }),
  Object.freeze({
    id: 'nothing',
    label: 'Nothing',
    actions: Object.freeze([Object.freeze({ id: 'none', label: 'Nothing' })]),
  }),
]);

const BY_ID = new Map(REMOTE_BUTTON_ACTION_GROUPS.flatMap((g) => g.actions.map((a) => [a.id, { ...a, group: g.id }])));

export const REMOTE_BUTTON_ACTION_IDS = Object.freeze([...BY_ID.keys()]);

/** { id, label, group } for an action id, or null. */
export function remoteButtonAction(id) {
  return BY_ID.get(id) || null;
}

export const REMOTE_POSITIONS = Object.freeze(['up', 'left', 'center', 'right', 'down']);

const ADDRESS = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
const KEY = /^[A-Za-z0-9_+\-.]{1,40}$/;
export const MAX_REMOTE_BUTTONS = 64;

/** An upper-case Bluetooth address, or null when it is not one. */
export function normalizeRemoteAddress(address) {
  const a = String(address ?? '').trim().toUpperCase();
  return ADDRESS.test(a) ? a : null;
}

/**
 * Check one remote's buttons ({ keyName: actionId }). Throws a TypeError
 * naming the first problem; returns a fresh, key-sorted copy.
 */
export function normalizeRemoteButtons(buttons) {
  if (!buttons || typeof buttons !== 'object' || Array.isArray(buttons)) throw new TypeError('buttons must be an object');
  const entries = Object.entries(buttons);
  if (entries.length > MAX_REMOTE_BUTTONS) throw new TypeError(`at most ${MAX_REMOTE_BUTTONS} buttons`);
  const out = {};
  for (const [key, action] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!KEY.test(key)) throw new TypeError(`bad key name: ${key}`);
    if (!BY_ID.has(action)) throw new TypeError(`unknown action for ${key}: ${action}`);
    out[key] = action;
  }
  return out;
}

/** Check one remote's positions ({ position: actionId }); a fresh copy, or a TypeError. */
export function normalizeRemotePositions(positions) {
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) throw new TypeError('positions must be an object');
  const out = {};
  for (const [pos, action] of Object.entries(positions)) {
    if (!REMOTE_POSITIONS.includes(pos)) throw new TypeError(`unknown position: ${pos}`);
    if (!BY_ID.has(action)) throw new TypeError(`unknown action for ${pos}: ${action}`);
    out[pos] = action;
  }
  return out;
}

/**
 * What a remote's button does when nothing is saved for it: the action its key
 * stands for (standard browser key names, the same on every device). A button
 * whose key is not here does nothing until it is set.
 */
export const DEFAULT_KEY_ACTIONS = Object.freeze({
  MediaPlayPause: 'play-pause', MediaTrackNext: 'next', MediaTrackPrevious: 'previous',
  AudioVolumeUp: 'volume-up', AudioVolumeDown: 'volume-down',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'select', Escape: 'back',
});

export function defaultActionForKey(key) {
  return DEFAULT_KEY_ACTIONS[String(key ?? '')] || null;
}
