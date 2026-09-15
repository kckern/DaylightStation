// frontend/src/modules/Media/cast/useDispatchTargetPicker.js
// State for the tap-a-device cast picker. Single-select is the primary
// interaction (tap a tile, cast); multi-select is an explicit opt-in
// affordance, not the default. Mode stays transfer/fork internally but the
// UI surfaces the choice whenever a source can potentially dispatch content.
// A `snapshot` source dispatches in adopt mode (hand-off).
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { useDispatch } from './useDispatch.js';
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
  const [dispatchError, setDispatchError] = useState(null);
  const localPlaying = useLocalPlaybackActive(source);
  // This only controls whether the picker can offer playback choices. A
  // getSnapshot source can disappear between render and submit, so it must
  // never be used as proof that submit has a payload to dispatch.
  const hasPotentialContent = !!(source?.getSnapshot || source?.snapshot || source?.play || source?.queue);
  const moveUnavailable = hasPotentialContent && mode === 'transfer';

  const devices = fleet.devices ?? [];

  // Every mount of this picker IS an "open" — it's only ever rendered while
  // a popover/portal/sheet is showing it (CastButton, NowPlayingView's
  // handoff section, DestinationLine's device sheet). Logged once per open
  // with whatever the fleet offered at that moment.
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  useEffect(() => {
    mediaLog.castSheetOpened({ offeredDeviceIds: devicesRef.current.map((d) => d.id) });
     
  }, []);

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

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    if (moveUnavailable) {
      setDispatchError('Move playback is not available yet. Choose the non-destructive option instead.');
      return { ok: false, error: 'move-unsupported' };
    }
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
    // The UI can expose a source before it resolves. Re-check the payload at
    // submit time so stopped playback cannot become an invalid dispatch.
    const hasDispatchContent = !!(params.snapshot || params.play || params.queue);
    if (hasPotentialContent && !hasDispatchContent) {
      setDispatchError('Playback is no longer available. Nothing was moved.');
      return { ok: false, error: 'content-unavailable' };
    }

    // A destination-only sheet (DestinationLine) mounts this picker with no
    // source at all: it changes the preferred target but does not dispatch.
    let dispatchIds = [];
    if (hasDispatchContent) {
      try {
        dispatchIds = await dispatchToTarget(params);
      } catch {
        setDispatchError('Could not start playback on that device. Nothing was moved.');
        return { ok: false, error: 'dispatch-failed' };
      }
    }
    if (hasDispatchContent && (!Array.isArray(dispatchIds) || dispatchIds.length === 0)) {
      setDispatchError('Could not start playback on that device. Nothing was moved.');
      return { ok: false, error: 'dispatch-failed' };
    }
    setDispatchError(null);
    onComplete?.({ targetIds, mode });
    return { ok: true, dispatchIds };
  }, [canSubmit, moveUnavailable, selected, mode, source, dispatchToTarget, onComplete, hasPotentialContent]);

  return { devices, selected, multi, mode, canSubmit, localPlaying, hasPotentialContent, moveUnavailable, dispatchError, select, toggleMulti, setMode, submit };
}

export default useDispatchTargetPicker;
