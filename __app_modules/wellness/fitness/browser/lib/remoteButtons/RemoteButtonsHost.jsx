// RemoteButtonsHost — the fitness app's Bluetooth remote buttons:
//  - loads and saves what each remote's buttons do
//    (GET/PUT /api/v1/fitness/remote-buttons, by Bluetooth address);
//  - the admin unlock for editing them (the same admin fingerprint unlock the
//    fitness locks use: IdentityProvider.registerAdmin + UnlockPrompt). Like
//    every fitness lock it is kiosk-only (isKioskEnv): off the kiosk there is
//    no reader to press, and the editor opens without one;
//  - the runtime: on the kiosk, each `bt.remote.key` press with a saved
//    action performs it (remoteButtonRuntime).
// The Bluetooth screen gets all of it as `bluetooth.remoteButtons` through
// useBluetoothScreenBluetooth() (remoteButtonsContext.js). Mounted inside IdentityProvider.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RemoteButtonsContext } from './remoteButtonsContext.js';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { isKioskEnv } from '@/lib/kioskEnv.js';
import { getActionBus } from '@/lib/input/ActionBus.js';
import { useOptionalIdentity } from '../../identity/useIdentity.js';
import { useFitnessBluetoothState } from '../../context/FitnessBluetoothContext.jsx';
import UnlockPrompt from '../../player/overlays/UnlockPrompt.jsx';
import { REMOTE_BUTTON_ACTION_GROUPS } from '../../../shared/remoteButtonActions.mjs';
import { NAV_SEMANTIC, PLAYBACK_METHOD, claimRemote, createRemoteButtonRuntime } from './remoteButtonRuntime.js';
import { createRemoteInputSource } from './remoteInputSource.js';
import { getPlaybackTarget } from './remotePlaybackTarget.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-remote-buttons' }));

const API = 'api/v1/fitness/remote-buttons';
const UNLOCK_LOCK = 'remote_buttons';
// Marks the key events this layer dispatches, so it never handles its own.
export const REMOTE_EVENT_FLAG = '__btRemoteButtons';


function dispatchKey(key) {
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : window;
  for (const type of ['keydown', 'keyup']) {
    const ev = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
    ev[REMOTE_EVENT_FLAG] = true;
    target.dispatchEvent(ev);
  }
}

/** Do one action. Returns where it went, for the log. */
export function performRemoteAction(action, { bus = getActionBus(), playback = getPlaybackTarget() } = {}) {
  const nav = NAV_SEMANTIC[action.id];
  if (nav) {
    if (bus?.hasCapture?.(nav.bus) && bus.emit(nav.bus, nav.payload) === true) return 'action-bus';
    dispatchKey(nav.key);
    return 'key';
  }
  const method = PLAYBACK_METHOD[action.id];
  if (method) {
    if (typeof playback?.[method] !== 'function') return 'no-player';
    playback[method]();
    return 'player';
  }
  return 'none';
}

// Rendered before the app: its effect runs before any child's, so its window
// listeners come first and can hold a browser key back from every other one.
function KeyGate({ gateRef }) {
  useEffect(() => {
    const down = (e) => gateRef.current?.down(e);
    const up = (e) => gateRef.current?.up(e);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, [gateRef]);
  return null;
}

export function RemoteButtonsHost({ children, kiosk = isKioskEnv() }) {
  const identity = useOptionalIdentity();
  const bluetooth = useFitnessBluetoothState()?.bluetooth || null;
  const subscribeRemoteKeys = bluetooth?.subscribeRemoteKeys || null;
  const [remotes, setRemotes] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState(null); // { label }
  const remotesRef = useRef(remotes);
  const gateRef = useRef(null);
  remotesRef.current = remotes;

  const load = useCallback(async () => {
    try {
      const doc = await DaylightAPI(API);
      setRemotes(doc?.remotes && typeof doc.remotes === 'object' ? doc.remotes : {});
      setLoaded(true);
      logger().info('fitness.remote-buttons.loaded', { remotes: Object.keys(doc?.remotes || {}).length });
    } catch (err) {
      logger().warn('fitness.remote-buttons.load-failed', { error: err?.message });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // input.yml's remotes: a remote with `positions:` keeps its actions by rider
  // position, so a press is resolved key → button → position. Kiosk only (the
  // runtime is), read once; the file changes by hand, rarely.
  const controllersRef = useRef([]);
  useEffect(() => {
    if (!kiosk) return undefined;
    let cancelled = false;
    DaylightAPI('api/v1/emulator/library').then((lib) => {
      if (cancelled) return;
      controllersRef.current = Array.isArray(lib?.input?.controllers) ? lib.input.controllers : [];
      logger().info('fitness.remote-buttons.inventory-loaded', { controllers: controllersRef.current.length });
    }).catch((err) => logger().warn('fitness.remote-buttons.inventory-failed', { error: err?.message }));
    return () => { cancelled = true; };
  }, [kiosk]);

  // `maps` is { buttons } or { positions } (remoteButtonActions.mjs says which).
  const save = useCallback(async (address, maps, { label = null, updatedBy = null } = {}) => {
    const addr = String(address).toUpperCase();
    const { buttons, positions } = maps || {};
    logger().info('fitness.remote-buttons.save-request', {
      address: addr, buttons: buttons ? Object.keys(buttons).length : null, positions: positions ? Object.keys(positions).length : null, updatedBy,
    });
    const doc = await DaylightAPI(`${API}/${encodeURIComponent(addr)}`, { ...(buttons ? { buttons } : {}), ...(positions ? { positions } : {}), label, updatedBy }, 'PUT');
    setRemotes(doc?.remotes || {});
    logger().info('fitness.remote-buttons.save-done', { address: addr });
    return doc;
  }, []);

  // Admin fingerprint, as the fitness locks ask for it. Off the kiosk (no
  // reader) the editor opens without one, as every fitness lock does.
  const requestEditUnlock = useCallback(async ({ address, label } = {}) => {
    if (!kiosk) {
      logger().info('fitness.remote-buttons.unlock-skipped', { address, reason: 'not-kiosk' });
      return { granted: true, userId: null, reason: 'not-kiosk' };
    }
    if (typeof identity?.registerAdmin !== 'function') {
      logger().warn('fitness.remote-buttons.unlock-unavailable', { address });
      return { granted: false, reason: 'no-identity' };
    }
    logger().info('fitness.remote-buttons.unlock-tap', { address });
    setPrompt({ label: label ? `Edit buttons on ${label}` : 'Edit buttons' });
    const verdict = await identity.registerAdmin(UNLOCK_LOCK);
    setPrompt(null);
    identity.clearUnlock?.();
    if (verdict?.matched && verdict.userId) {
      logger().info('fitness.remote-buttons.unlock-granted', { address, userId: verdict.userId });
      return { granted: true, userId: verdict.userId };
    }
    logger().info('fitness.remote-buttons.unlock-denied', { address, reason: verdict?.reason || 'denied' });
    return { granted: false, reason: verdict?.reason || 'denied' };
  }, [kiosk, identity]);

  // The runtime: kiosk only — every fitness page hears the garage's remotes,
  // and only the garage screen should act on them.
  useEffect(() => {
    if (!kiosk || typeof subscribeRemoteKeys !== 'function') return undefined;
    // The bus feed and input.yml, adapted into abstract remote input.
    const source = createRemoteInputSource({
      subscribeRemoteKeys,
      getController: (address) => controllersRef.current.find((c) => String(c?.address || '').toUpperCase() === address) || null,
    });
    const runtime = createRemoteButtonRuntime({
      getRemotes: () => remotesRef.current,
      controlOf: source.controlOf,
      perform: (action, ctx) => {
        const to = performRemoteAction(action);
        logger().sampled('fitness.remote-buttons.performed', { ...ctx, action: action.id, to }, { maxPerMinute: 30, aggregate: true });
      },
      replay: ({ key, init, target }) => {
        const ev = new KeyboardEvent('keydown', { ...init, key, bubbles: true, cancelable: true });
        ev[REMOTE_EVENT_FLAG] = true;
        (target && target.isConnected ? target : window).dispatchEvent(ev);
      },
      log: (event, data, level) => {
        if (level === 'sampled') logger().sampled(event, data, { maxPerMinute: 30, aggregate: true });
        else logger()[level || 'info'](event, data);
      },
    });
    const offKeys = source.subscribe((ev) => runtime.input(ev));
    gateRef.current = {
      down: (e) => {
        if (e[REMOTE_EVENT_FLAG] || e.__gamepadSynthetic) return;
        const verdict = runtime.browserKeydown({
          key: e.key, repeat: e.repeat, target: e.target,
          init: { code: e.code, location: e.location, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
        });
        if (verdict === 'swallow') { e.preventDefault(); e.stopImmediatePropagation(); }
      },
      up: (e) => {
        if (e[REMOTE_EVENT_FLAG]) return;
        if (runtime.browserKeyup({ key: e.key }) === 'swallow') { e.preventDefault(); e.stopImmediatePropagation(); }
      },
    };
    logger().info('fitness.remote-buttons.runtime-start', {});
    return () => {
      offKeys?.();
      runtime.stop();
      gateRef.current = null;
    };
  }, [kiosk, subscribeRemoteKeys]);

  const value = useMemo(() => ({
    remotes, loaded, groups: REMOTE_BUTTON_ACTION_GROUPS, save, requestEditUnlock, claim: claimRemote, reload: load,
  }), [remotes, loaded, save, requestEditUnlock, load]);

  return (
    <RemoteButtonsContext.Provider value={value}>
      <KeyGate gateRef={gateRef} />
      {children}
      {prompt ? (
        <UnlockPrompt
          open
          state={identity?.unlockState || 'scanning'}
          unlockedUser={identity?.unlockedUser}
          lockLabel={prompt.label}
          onCancel={() => { identity?.clearUnlock?.(); }}
        />
      ) : null}
    </RemoteButtonsContext.Provider>
  );
}

export default RemoteButtonsHost;
