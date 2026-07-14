// frontend/src/modules/Media/cast/useDispatchTargetPicker.js
// State for the tap-a-device cast picker. Single-select is the primary
// interaction (tap a tile, cast); multi-select is an explicit opt-in
// affordance, not the default. Mode stays transfer/fork internally but the
// UI only surfaces the choice when something is actually playing locally.
// A `snapshot` source dispatches in adopt mode (hand-off).
import { useCallback, useContext, useState, useSyncExternalStore } from 'react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useDispatch } from './DispatchProvider.jsx';
import { useCastTarget } from './useCastTarget.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import mediaLog from '../logging/mediaLog.js';

const NOOP_UNSUB = () => {};
const LOCAL_ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

/**
 * Is anything playing (or paused mid-something) locally? Drives whether the
 * "move vs keep playing here" choice is even worth showing. A hand-off
 * source implies local playback by construction; otherwise read the local
 * session controller when one is mounted, defaulting to false.
 */
function useLocalPlaybackActive(source) {
  const local = useContext(LocalSessionContext);
  const controller = local?.controller ?? null;
  const subscribe = useCallback(
    (cb) => (controller ? controller.subscribe(cb) : NOOP_UNSUB),
    [controller]
  );
  const get = useCallback(
    () => (controller ? controller.getSnapshot() : null),
    [controller]
  );
  const snap = useSyncExternalStore(subscribe, get, get);
  if (source?.getSnapshot || source?.snapshot) return true;
  return !!(snap?.currentItem && LOCAL_ACTIVE_STATES.has(snap.state));
}

export function useDispatchTargetPicker({ source, onComplete } = {}) {
  const fleet = useFleetContext();
  const { dispatchToTarget } = useDispatch();
  const { targetIds: defaultTargets, mode: defaultMode } = useCastTarget();
  const [selected, setSelected] = useState(() => new Set(defaultTargets));
  const [multi, setMulti] = useState(() => defaultTargets.length > 1);
  const [mode, setMode] = useState(defaultMode ?? 'transfer');
  const localPlaying = useLocalPlaybackActive(source);

  const devices = fleet.devices ?? [];

  // Tap a tile: radio-like in single mode (tap again to deselect),
  // accumulating in multi mode.
  const select = useCallback((id) => {
    setSelected((prev) => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return prev.has(id) && prev.size === 1 ? new Set() : new Set([id]);
    });
  }, [multi]);

  // Leaving multi mode collapses the selection back to one device so the
  // single-select invariant holds.
  const toggleMulti = useCallback(() => {
    setMulti((wasMulti) => {
      if (wasMulti) setSelected((prev) => new Set([...prev].slice(0, 1)));
      return !wasMulti;
    });
  }, []);

  const canSubmit = selected.size > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const targetIds = Array.from(selected);
    const params = { targetIds, mode };
    // Hand-off snapshots are captured AT SUBMIT so the position is current.
    const snapshot = source?.getSnapshot?.() ?? source?.snapshot;
    if (snapshot) {
      params.snapshot = snapshot;
      mediaLog.handoffInitiated({ deviceIds: targetIds, mode });
    }
    else if (source?.play) params.play = source.play;
    else if (source?.queue) params.queue = source.queue;
    // Human title for the progress tray (never the raw content id).
    const title = source?.title ?? snapshot?.currentItem?.title ?? null;
    if (title) params.title = title;
    dispatchToTarget(params);
    onComplete?.({ targetIds, mode });
  }, [canSubmit, selected, mode, source, dispatchToTarget, onComplete]);

  return { devices, selected, multi, mode, canSubmit, localPlaying, select, toggleMulti, setMode, submit };
}

export default useDispatchTargetPicker;
