// frontend/src/modules/Media/controller/useSessionControls.js
// One hook for the screen session controls of whatever is being steered —
// this device's session or another screen (tech doc §4.9, §6.6, §9.14) —
// so the controls surface is written once (STEER.1b: same controls, same
// layout). Local state comes from `controller.sessionControls`; a screen's
// comes from its published `snapshot.controls`, and its commands go through
// `controller.sessionControls` (RemoteSessionController), resolving on ack.
//
// Returns `{ controls, actions, available, reason, supports, kind }`.
// `available: false` (with a short reason) means the controls are shown as
// unavailable, never hidden (STEER.1b/AC2).
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { useSessionController } from './useSessionController.js';

const NO_SUBSCRIBE = () => () => {};
const NULL_STATE = () => null;

export const REMOTE_CONTROLS_UNSUPPORTED = 'This screen does not offer sleep timer, end of queue or Add only';
export const REMOTE_CONTROLS_UNREPORTED = 'This screen has not reported its session controls yet';

const REMOTE_SUPPORTS = Object.freeze({
  addOnly: true, notes: true, sleepTimer: true, endOfQueue: true, stopAfterCurrent: true, countdown: true,
});
const NO_SUPPORTS = Object.freeze({
  addOnly: false, notes: false, sleepTimer: false, endOfQueue: false, stopAfterCurrent: false, countdown: false,
});

export function useSessionControls(target) {
  const { controller, snapshot } = useSessionController(target);
  const local = useContext(LocalSessionContext);
  const isLocal = target === 'local';
  const localControls = isLocal ? (local?.controller?.sessionControls ?? null) : null;

  const subscribe = useCallback(
    (cb) => (localControls ? localControls.subscribe(cb) : NO_SUBSCRIBE()),
    [localControls],
  );
  const getLocal = useCallback(() => localControls?.getState?.() ?? null, [localControls]);
  // getState() builds a fresh object; keep a stable reference per change so
  // useSyncExternalStore does not loop.
  const localState = useSyncExternalStore(
    localControls ? subscribe : NO_SUBSCRIBE,
    localControls ? cachedGetter(localControls, getLocal) : NULL_STATE,
    localControls ? cachedGetter(localControls, getLocal) : NULL_STATE,
  );

  if (isLocal) {
    return {
      kind: 'local',
      controls: localState,
      actions: localControls,
      available: !!localControls,
      reason: localControls ? null : 'Session controls are unavailable on this device',
      supports: localControls?.supports ?? NO_SUPPORTS,
    };
  }
  const actions = controller?.sessionControls ?? null;
  const published = snapshot?.controls ?? null;
  if (!actions) {
    return { kind: 'remote', controls: null, actions: null, available: false, reason: REMOTE_CONTROLS_UNSUPPORTED, supports: NO_SUPPORTS };
  }
  return {
    kind: 'remote',
    controls: published,
    actions,
    available: !!published,
    reason: published ? null : REMOTE_CONTROLS_UNREPORTED,
    supports: REMOTE_SUPPORTS,
  };
}

// Per-controls cache: the same state object is returned until the controls
// notify, so React sees a stable snapshot between changes.
const caches = new WeakMap();
function cachedGetter(controls, read) {
  let entry = caches.get(controls);
  if (!entry) {
    entry = { value: read(), dirty: false, getter: null };
    controls.subscribe(() => { entry.dirty = true; });
    entry.getter = () => {
      if (entry.dirty) { entry.value = read(); entry.dirty = false; }
      return entry.value;
    };
    caches.set(controls, entry);
  }
  return entry.getter;
}

/** Re-render once a second while `active`, for countdowns and time left. */
export function useSecondTick(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Seconds until an ISO deadline, ticking once a second while mounted. */
export function secondsUntil(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : null;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export default useSessionControls;
