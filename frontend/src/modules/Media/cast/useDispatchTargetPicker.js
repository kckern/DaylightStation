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
import { useHandOff } from './useHandOff.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { describeBusy } from './castCopy.js';
import mediaLog from '../logging/mediaLog.js';

const NOOP_UNSUB = () => {};
const LOCAL_ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

/**
 * Is anything playing (or paused mid-something) locally? Drives whether the
 * "move vs keep playing here" choice is even worth showing. A hand-off
 * source implies local playback by construction; otherwise read the local
 * session controller when one is mounted, defaulting to false.
 */
export function useLocalPlaybackActive(source) {
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

export function useDispatchTargetPicker({ source, onComplete, intent = 'dispatch' } = {}) {
  const fleet = useFleetContext();
  const { dispatchToTarget } = useDispatch();
  const handOff = useHandOff();
  const { targetIds: defaultTargets, mode: defaultMode, setMode: rememberMode } = useCastTarget();
  const local = useContext(LocalSessionContext)?.controller ?? null;
  const [selected, setSelected] = useState(() => new Set(defaultTargets));
  const [multi, setMulti] = useState(() => defaultTargets.length > 1);
  // A play/queue source has no session to move, so it can only ever fork.
  const noSnapshotSource = !!(source?.play || source?.queue) && !(source?.getSnapshot || source?.snapshot);
  const localPlaying = useLocalPlaybackActive(source);
  // PLACE.6a/AC2: a one-off Play on… of an item, while something plays HERE,
  // asks at that moment whether this device stops (Move) or keeps playing,
  // pre-set to the remembered choice. Brief shows and destination-only picks
  // never touch local playback, so they never ask.
  const asksKeepOrStop = noSnapshotSource && !source?.brief && intent !== 'destination' && localPlaying;
  const [mode, setModeState] = useState(
    asksKeepOrStop ? (defaultMode ?? 'transfer')
      : (source?.itemAction || source?.brief || noSnapshotSource ? 'fork' : (defaultMode ?? 'transfer'))
  );
  const setMode = useCallback((next) => {
    setModeState(next);
    if (asksKeepOrStop) {
      rememberMode?.(next);
      mediaLog.playOnChoiceChanged({ mode: next });
    }
  }, [asksKeepOrStop, rememberMode]);
  const [dispatchError, setDispatchError] = useState(null);
  // This only controls whether the picker can offer playback choices. A
  // getSnapshot source can disappear between render and submit, so it must
  // never be used as proof that submit has a payload to dispatch.
  const hasPotentialContent = !!(source?.getSnapshot || source?.snapshot || source?.play || source?.queue);
  const hasMoveSnapshot = !!(source?.getSnapshot || source?.snapshot);
  const moveSupported = hasMoveSnapshot && selected.size === 1;
  const moveUnavailable = hasPotentialContent && mode === 'transfer' && !moveSupported && !asksKeepOrStop;

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

  // NF-TAP-10: a plain "play this on X" (no move, no brief, single-select, an
  // idle target) is sent by the tile tap itself; the CTA stays for keyboard and
  // screen-reader users. A busy target, a move source or multi-select keeps
  // select -> confirm.
  const submitRef = useRef(null);
  const autoSendOnSelect = useCallback((id) => {
    if (multi || intent === 'destination' || source?.brief || hasMoveSnapshot || asksKeepOrStop) return false;
    if (!(source?.play || source?.queue)) return false;
    if (describeBusy(fleet.store?.getEntry?.(id))) return false;
    return true;
  }, [multi, intent, source, hasMoveSnapshot, fleet.store, asksKeepOrStop]);

  // Tap a tile: radio-like in single mode (tap again to deselect),
  // accumulating in multi mode.
  const select = useCallback((id) => {
    if (autoSendOnSelect(id)) {
      setSelected(new Set([id]));
      submitRef.current?.([id]);
      return;
    }
    setSelected((prev) => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return prev.has(id) && prev.size === 1 ? new Set() : new Set([id]);
    });
  }, [multi, autoSendOnSelect]);

  // Leaving multi mode collapses the selection back to one device so the
  // single-select invariant holds.
  const toggleMulti = useCallback(() => {
    setMulti((wasMulti) => {
      if (wasMulti) setSelected((prev) => new Set([...prev].slice(0, 1)));
      return !wasMulti;
    });
  }, []);

  const canSubmit = selected.size > 0;

  const submit = useCallback(async (idsOverride) => {
    const chosen = Array.isArray(idsOverride) ? idsOverride : Array.from(selected);
    if (chosen.length === 0) return;
    if (moveUnavailable) {
      setDispatchError(hasMoveSnapshot
        ? 'Move playback to one screen at a time.'
        : 'Move needs an active session. Keep playing here instead.');
      return { ok: false, error: 'move-unsupported' };
    }
    const targetIds = chosen;
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
    if (source?.itemAction) params.itemAction = source.itemAction;
    if (source?.brief) params.brief = true;
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
    if (hasDispatchContent && mode === 'transfer' && !asksKeepOrStop) {
      const outcome = await handOff(targetIds[0], { mode });
      if (!outcome?.ok) {
        setDispatchError(`Could not confirm the move${outcome?.error ? `: ${outcome.error}` : ''}. Playback here was kept.`);
        return outcome ?? { ok: false, error: 'move-unconfirmed' };
      }
      setDispatchError(null);
      onComplete?.({ targetIds, mode });
      return outcome;
    }
    if (hasDispatchContent) {
      try {
        if (asksKeepOrStop) {
          // The item is a second-room start either way; Move additionally
          // stops THIS device, but only once the screen has accepted the
          // start, and only if this device is still on what it was playing.
          params.mode = 'fork';
          const identity = mode === 'transfer' ? (local?.portability?.capture?.()?.identity ?? null) : null;
          mediaLog.playOnChoiceApplied({ mode, targetIds });
          if (mode === 'transfer') {
            params.onSucceeded = () => {
              const result = identity && local?.portability?.stopIfCurrent
                ? local.portability.stopIfCurrent(identity)
                : { ok: false, code: 'NO_IDENTITY' };
              mediaLog.playOnStopHere({ targetIds, ok: result?.ok === true, code: result?.code ?? null });
            };
          }
        }
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
  }, [moveUnavailable, hasMoveSnapshot, selected, mode, source, dispatchToTarget, handOff, onComplete, hasPotentialContent, asksKeepOrStop, local]);

  submitRef.current = submit;

  return { devices, selected, multi, mode, asksKeepOrStop, canSubmit, localPlaying, hasPotentialContent, moveSupported, moveUnavailable, dispatchError, select, toggleMulti, setMode, submit };
}

export default useDispatchTargetPicker;
