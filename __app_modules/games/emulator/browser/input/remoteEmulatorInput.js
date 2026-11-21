// remoteEmulatorInput.js — pure model for driving a game from a Bluetooth
// remote's `bt.remote.key` presses (a remote the browser Gamepad API never
// sees; its host decodes it and tags each press with the remote's address).
//
// Config (media/emulation/input.yml), on a `controllers:` entry with an
// `address`, a `buttons:` record (physical control -> bt.remote.key name) and
// an `emulator:` map (physical control -> RetroPad button):
//
//   buttons:  { upper_trigger: Trigger1, stick_up: StickUp, ... }
//   emulator:
//     stick_up: up
//     upper_trigger: a
//     systems:              # optional, per-system overrides merged over the rest
//       genesis: { d: x }
//
// A physical name not in `buttons:` is taken as the key name itself. Values are
// the semantic RetroPad names of the IEmulatorInput port (RETROPAD_BUTTONS); an
// unknown value is dropped. Code never names a device: everything comes from
// the entry. Nothing here knows the emulator: presses go to an IEmulatorInput.
import { RETROPAD_BUTTONS, isEmulatorInput } from '../ports/IEmulatorInput.js';

const BUTTONS = new Set(RETROPAD_BUTTONS);

const upper = (a) => String(a || '').toUpperCase();

/**
 * Remotes with an `emulator:` map, keyed by upper-case Bluetooth address.
 * @param {Array<object>} controllers  input.yml `controllers:`
 * @param {string|null} system          the running game's system id (gb, genesis, snes, …)
 * @returns {Map<string, {id:string|null, label:string|null, keys:Map<string,string>}>}  key name -> RetroPad button
 */
export function resolveRemoteEmulatorMaps(controllers, system = null) {
  const out = new Map();
  for (const c of Array.isArray(controllers) ? controllers : []) {
    if (!c || typeof c !== 'object' || !c.address) continue;
    const emu = c.emulator;
    if (!emu || typeof emu !== 'object') continue;
    const { systems, ...base } = emu;
    const override = (system && systems && typeof systems === 'object' && systems[system]) || {};
    const merged = { ...base, ...(typeof override === 'object' ? override : {}) };
    const buttons = (c.buttons && typeof c.buttons === 'object') ? c.buttons : {};
    const keys = new Map();
    for (const [physical, semantic] of Object.entries(merged)) {
      const button = String(semantic || '').toLowerCase();
      if (!BUTTONS.has(button)) continue;
      const key = typeof buttons[physical] === 'string' && buttons[physical] ? buttons[physical] : physical;
      keys.set(key, button);
    }
    if (keys.size > 0) out.set(upper(c.address), { id: c.id ?? null, label: c.label ?? null, keys });
  }
  return out;
}

/**
 * Hold tracker: turns down/up/repeat presses into exactly one press and one
 * release per RetroPad button on an IEmulatorInput. Two physical controls on the same
 * button are counted, so releasing one keeps the button held while the other
 * is still down. A repeat with no down (the down was missed) counts as a down;
 * an up with no down is ignored.
 *
 * @param {object} opts
 * @param {import('../ports/IEmulatorInput.js').IEmulatorInput} opts.input
 * @returns {{ handle(msg:object, maps:Map):object|null, releaseRemote(address:string):number, releaseAll():number, heldCount():number }}
 */
export function createRemoteHoldTracker({ input }) {
  if (!isEmulatorInput(input)) throw new TypeError('createRemoteHoldTracker needs an IEmulatorInput');
  const held = new Map();   // address -> Map<key, button>
  const counts = new Map(); // button -> number of physical controls holding it

  const down = (button) => {
    const n = counts.get(button) || 0;
    counts.set(button, n + 1);
    if (n === 0) input.press(button);
  };
  const up = (button) => {
    const n = counts.get(button) || 0;
    if (n <= 1) { counts.delete(button); if (n === 1) input.release(button); }
    else counts.set(button, n - 1);
  };

  function handle(msg, maps) {
    const address = upper(msg?.address);
    const remote = maps?.get(address);
    if (!remote) return null;
    const button = remote.keys.get(msg?.key);
    if (!button) return null;
    let keys = held.get(address);
    const isHeld = !!keys?.has(msg.key);
    const state = msg.state;
    if (state === 'down' || (state === 'repeat' && !isHeld)) {
      if (isHeld) return { action: 'ignored', button };
      if (!keys) { keys = new Map(); held.set(address, keys); }
      keys.set(msg.key, button);
      down(button);
      return { action: 'down', button };
    }
    if (state === 'up') {
      if (!isHeld) return { action: 'ignored', button };
      keys.delete(msg.key);
      if (keys.size === 0) held.delete(address);
      up(button);
      return { action: 'up', button };
    }
    return { action: 'ignored', button };
  }

  function releaseRemote(address) {
    const a = upper(address);
    const keys = held.get(a);
    if (!keys) return 0;
    held.delete(a);
    for (const button of keys.values()) up(button);
    return keys.size;
  }

  function releaseAll() {
    let n = 0;
    for (const a of [...held.keys()]) n += releaseRemote(a);
    return n;
  }

  const heldCount = () => [...held.values()].reduce((s, k) => s + k.size, 0);

  return { handle, releaseRemote, releaseAll, heldCount };
}
