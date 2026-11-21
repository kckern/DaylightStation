// useRemoteEmulatorInput — drive the running game from Bluetooth remotes that
// the browser Gamepad API never sees (their presses arrive as `bt.remote.key`
// from the host, tagged with the remote's address). See remoteEmulatorInput.js for the input.yml shape.
//
// While `active` (the game is playing: not paused, no menu open), each mapped
// remote is CLAIMED through the host's `bluetooth.claimRemoteKeys(address, fn)`,
// so no other remote-mapping layer acts on its presses; the presses become
// RetroPad presses on the injected `input` (an IEmulatorInput port; the
// EmulatorJS one is adapters/EmulatorJSInputAdapter). A host without claims
// falls back to `subscribeRemoteKeys`.
//
// Nothing may stick: every held button is released when the game stops
// playing, on unmount, when the window loses focus or is hidden, and when the
// remote shows as disconnected in the Bluetooth inventory.
import { useEffect, useMemo, useRef } from 'react';
import { createRemoteHoldTracker, resolveRemoteEmulatorMaps } from './remoteEmulatorInput.js';
import { isEmulatorInput } from '../ports/IEmulatorInput.js';

const upper = (a) => String(a || '').toUpperCase();

/**
 * @param {object} opts
 * @param {object|null} opts.bluetooth   host bluetooth object (claimRemoteKeys / subscribeRemoteKeys / inventory)
 * @param {Array<object>} opts.controllers input.yml controllers
 * @param {string|null} opts.system      running game's system id
 * @param {boolean} opts.active           the game is playing
 * @param {import('../ports/IEmulatorInput.js').IEmulatorInput} opts.input  the game's controller port
 * @param {object} opts.logger
 */
export function useRemoteEmulatorInput({ bluetooth, controllers, system, active, input, logger }) {
  const maps = useMemo(() => resolveRemoteEmulatorMaps(controllers, system), [controllers, system]);
  // One tracker per input; presses must never throw into the bus fan-out.
  const tracker = useMemo(() => (!isEmulatorInput(input) ? null : createRemoteHoldTracker({
    input: {
      press: (b) => { try { return input.press(b); } catch { return false; } },
      release: (b) => { try { return input.release(b); } catch { return false; } },
      releaseAll: () => input.releaseAll(),
      isReady: () => input.isReady(),
    },
  })), [input]);
  const trackerRef = useRef(tracker);
  trackerRef.current = tracker;
  const claim = bluetooth?.claimRemoteKeys || null;
  const subscribe = bluetooth?.subscribeRemoteKeys || null;
  const addressKey = [...maps.keys()].join(',');

  const release = (reason, address = null) => {
    const tracker = trackerRef.current;
    if (!tracker) return 0;
    const n = address ? tracker.releaseRemote(address) : tracker.releaseAll();
    if (n > 0) logger?.warn?.('emulator.remote.stuck-release', { reason, released: n, address });
    return n;
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;

  // Claim + route while the game is playing.
  useEffect(() => {
    if (!active || maps.size === 0 || !tracker) return undefined;
    if (typeof claim !== 'function' && typeof subscribe !== 'function') return undefined;
    let first = true;
    const onKey = (msg) => {
      if (!input.isReady()) return;
      const r = tracker.handle(msg, maps);
      if (!r || r.action === 'ignored') return;
      const data = { address: upper(msg.address), key: msg.key, state: msg.state, button: r.button, system };
      if (first && r.action === 'down') { first = false; logger?.info?.('emulator.remote.input', { ...data, first: true }); }
      else logger?.sampled?.('emulator.remote.input', data, { maxPerMinute: 20, aggregate: true });
    };
    const offs = typeof claim === 'function'
      ? [...maps.keys()].map((address) => claim(address, onKey))
      : [subscribe((msg) => { if (maps.has(upper(msg?.address))) onKey(msg); })];
    logger?.info?.('emulator.remote.mount', {
      system, remotes: [...maps.values()].map((m) => m.id), mode: typeof claim === 'function' ? 'claim' : 'subscribe',
    });
    return () => {
      offs.forEach((off) => { try { off?.(); } catch { /* ignore */ } });
      releaseRef.current('inactive');
      logger?.info?.('emulator.remote.unmount', { system });
    };
    // addressKey stands for maps' contents; claim/subscribe are stable host callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, addressKey, claim, subscribe, system, tracker]);

  // Focus loss: a release that happens while the window is blurred never arrives.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onBlur = () => releaseRef.current('blur');
    const onVis = () => { if (document.visibilityState === 'hidden') releaseRef.current('hidden'); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      releaseRef.current('unmount');
    };
  }, []);

  // A remote that drops off mid-press never sends its release.
  const inventory = bluetooth?.inventory;
  useEffect(() => {
    if (!Array.isArray(inventory)) return;
    for (const row of inventory) {
      if (row && row.connected === false && maps.has(upper(row.address))) releaseRef.current('disconnected', row.address);
    }
  }, [inventory, maps]);
}
