// remoteButtonRuntime — performs a Bluetooth remote's saved button actions on
// the garage fitness screen.
//
// Input: abstract remote input from a source (remoteInputSource.js adapts the
// garage bus feed and input.yml): { remote, kind, control, state, key }. A
// press whose remote has a saved action for that control performs it, unless that remote is claimed (its page is
// open on the Bluetooth screen: presses there are for trying it) or the
// runtime is held (a Skyline Invaders round, which ignores pads and keys).
//
// The browser's own copy. A keyboard-mode remote's press ALSO reaches the
// page as a KeyboardEvent with no device identity, in either order with its
// tagged twin. A key set on an acting remote must not also do what that key
// natively does, so browser keys that any acting remote has set are held back
// up to `windowMs` for their twin: a twin from an acting remote that has the
// key set drops the browser copy; a twin from any other remote, or no twin at
// all (a USB keyboard, an old satellite), lets it through by replaying it.
// Keys no acting remote has set pass untouched, at once.
import { normalizeKey } from '../../../../../games/emulator/browser/remoteKeys.mjs';
import { remoteButtonAction } from '../../../shared/remoteButtonActions.mjs';
import { isRemoteHeld, remoteButtonHolds } from './remoteButtonHolds.js';

// Held long enough to repeat: only these act on a key repeat.
const REPEATS = new Set(['volume-up', 'volume-down']);

/**
 * The saved action id for one control of a remote: its `positions` map for a
 * position, its `buttons` map for a key. @param {object|null} entry the saved entry.
 */
export function savedActionId(entry, { kind, control } = {}) {
  if (!entry || !control) return null;
  return (kind === 'position' ? entry.positions : entry.buttons)?.[control] || null;
}

// Who owns a remote's presses (a game's hold, the Bluetooth screen's claim)
// is remoteButtonHolds.js, the contract every remote layer checks.
export { claimRemote, holdRemoteButtons, isRemoteClaimed, remoteButtonHolds, resetRemoteButtonHolds } from './remoteButtonHolds.js';

/**
 * @param {object} p
 * @param {() => object} p.getRemotes  { ADDRESS: { buttons, positions } } (saved)
 * @param {(remote: string, key: string) => {kind, control}} p.controlOf  the source's resolver,
 *   used only to tell which control a BROWSER key would be on each remote
 * @param {(action: {id, label, group}, ctx: object) => void} p.perform
 * @param {(pending: {key, init, target}) => void} p.replay  re-dispatch a held browser key
 * @param {(event: string, data: object, level?: string) => void} [p.log]
 */
export function createRemoteButtonRuntime({
  getRemotes, controlOf = (remote, key) => ({ kind: 'key', control: normalizeKey(key) }), perform, replay, log = () => {}, windowMs = 400,
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  isHeld = isRemoteHeld,
}) {
  const recentTagged = []; // { key, address, acting, at }
  const pending = [];      // { key, init, target, at, timer }
  const lastBrowser = new Map(); // key -> 'swallow' | 'pass'
  const prune = () => { const t = now(); while (recentTagged.length && t - recentTagged[0].at > windowMs) recentTagged.shift(); };

  // The saved action of (address, key) when that remote is acting now.
  const savedId = (address, control) => savedActionId(getRemotes()?.[address], control);
  const actionFor = (address, control) => {
    const id = savedId(address, control);
    if (!id || isHeld(address)) return null;
    return remoteButtonAction(id);
  };
  const keySetOnActing = (key) => Object.keys(getRemotes() || {})
    .some((address) => savedId(address, controlOf(address, key)) && !isHeld(address));

  return {
    /** One abstract remote input: { remote, kind, control, state, key }. */
    input(ev = {}) {
      const address = String(ev.remote || '').toUpperCase();
      const key = normalizeKey(ev.key ?? '');
      if (!address || !ev.control || ev.state === 'up') return;
      const control = { kind: ev.kind || 'key', control: ev.control };
      const action = actionFor(address, control);
      if (ev.state === 'repeat') {
        if (action && REPEATS.has(action.id)) perform(action, { address, control: ev.control, repeat: true });
        return;
      }
      const i = pending.findIndex((p) => p.key === key);
      if (i >= 0) {
        const [p] = pending.splice(i, 1);
        clearTimer(p.timer);
        if (action) lastBrowser.set(key, 'swallow');
        else { lastBrowser.set(key, 'pass'); replay(p); }
      } else {
        prune();
        recentTagged.push({ key, address, acting: !!action, at: now() });
      }
      if (!action) {
        const id = savedId(address, control);
        if (id) log('fitness.remote-buttons.held', { address, control: ev.control, action: id, reason: remoteButtonHolds().join(',') || 'claimed' }, 'debug');
        return;
      }
      if (action.id !== 'none') perform(action, { address, control: ev.control, repeat: false });
      log('fitness.remote-buttons.action', { address, control: ev.control, action: action.id }, 'sampled');
    },

    /**
     * A browser keydown. Returns 'pass' (leave it) or 'swallow' (the caller
     * stops it; it may be replayed later through `replay`).
     */
    browserKeydown({ key: rawKey, init = {}, target = null, repeat = false } = {}) {
      const key = normalizeKey(rawKey);
      if (repeat) return lastBrowser.get(key) === 'swallow' ? 'swallow' : 'pass';
      prune();
      const twin = recentTagged.findIndex((r) => r.key === key);
      if (twin >= 0) {
        const [t] = recentTagged.splice(twin, 1);
        const d = t.acting ? 'swallow' : 'pass';
        lastBrowser.set(key, d);
        return d;
      }
      if (!keySetOnActing(key)) { lastBrowser.set(key, 'pass'); return 'pass'; }
      const entry = { key, init, target, at: now(), timer: null };
      entry.timer = setTimer(() => {
        const i = pending.indexOf(entry);
        if (i < 0) return;
        pending.splice(i, 1);
        lastBrowser.set(key, 'pass');
        replay(entry);
      }, windowMs);
      pending.push(entry);
      lastBrowser.set(key, 'swallow');
      return 'swallow';
    },

    /** A browser keyup: swallowed when its keydown was. */
    browserKeyup({ key: rawKey } = {}) {
      return lastBrowser.get(normalizeKey(rawKey)) === 'swallow' ? 'swallow' : 'pass';
    },

    stop() { pending.forEach((p) => clearTimer(p.timer)); pending.length = 0; recentTagged.length = 0; },
  };
}

// Navigate actions → the screen's semantic input. A modal that captured the
// action on the ActionBus gets it; otherwise the key it stands for is
// dispatched (as the gamepad adapter does), so keyboard-driven fitness menus
// move exactly as they do for an arrow key.
export const NAV_SEMANTIC = {
  up: { bus: 'navigate', payload: { direction: 'up' }, key: 'ArrowUp' },
  down: { bus: 'navigate', payload: { direction: 'down' }, key: 'ArrowDown' },
  left: { bus: 'navigate', payload: { direction: 'left' }, key: 'ArrowLeft' },
  right: { bus: 'navigate', payload: { direction: 'right' }, key: 'ArrowRight' },
  select: { bus: 'select', payload: {}, key: 'Enter' },
  back: { bus: 'escape', payload: {}, key: 'Escape' },
};

// Playback actions → the fitness player's own controls (registerPlaybackTarget).
export const PLAYBACK_METHOD = {
  'play-pause': 'playPause', next: 'next', previous: 'previous', 'volume-up': 'volumeUp', 'volume-down': 'volumeDown',
};
