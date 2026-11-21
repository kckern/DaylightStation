// remoteInputSource — the adapter between the garage's Bluetooth remotes and
// anything in the fitness app that acts on them. It turns the bus feed
// (`bt.remote.key`: a key name tagged with the remote's Bluetooth address)
// and input.yml (`buttons:` / `positions:`) into abstract remote input:
//
//   { remote: ADDRESS, kind: 'position' | 'key', control, state, key }
//
// `control` is the rider position (up/down/left/right/center) for a remote
// whose entry has `positions:`, else the key name; `state` is down/up/repeat;
// `key` is the browser key the press also arrives as, kept only so a consumer
// can recognise the browser's own copy of the same press.
import { normalizeKey } from '../../../../../games/emulator/browser/remoteKeys.mjs';
import { remoteDirection } from '../remoteInput/remoteDirection.js';

// The shared resolver (key → button → position): a position when the remote's
// entry places that button, else the key itself.
function controlOfKey(controller, key) {
  const where = remoteDirection(controller, key);
  return where ? { kind: 'position', control: where.position } : { kind: 'key', control: normalizeKey(key) };
}

/**
 * @param {object} p
 * @param {(fn: Function) => Function} p.subscribeRemoteKeys  the bus feed (useFitnessBluetooth)
 * @param {(address: string) => object|null} p.getController  the remote's input.yml entry
 */
export function createRemoteInputSource({ subscribeRemoteKeys, getController = () => null }) {
  const controlOf = (remote, key) => controlOfKey(getController(String(remote || '').toUpperCase()), key);
  return {
    controlOf,
    subscribe(fn) {
      if (typeof subscribeRemoteKeys !== 'function') return () => {};
      return subscribeRemoteKeys((msg) => {
        const remote = String(msg?.address || '').toUpperCase();
        if (!remote || !msg?.key) return;
        const key = normalizeKey(msg.key);
        fn({ remote, ...controlOf(remote, key), state: msg.state || 'down', key });
      });
    },
  };
}
