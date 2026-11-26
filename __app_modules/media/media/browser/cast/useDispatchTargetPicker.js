// frontend/src/modules/Media/cast/useDispatchTargetPicker.js
// State for the tap-a-device cast picker. Single-select is the primary
// interaction: a tap on a screen that is free sends at once; a tap on a screen
// that is playing something asks, in that row, before replacing it
// (`pendingId`). Multi-select is an explicit opt-in and the only path with a
// confirm button. Mode stays transfer/fork internally; the UI shows it as one
// "Stop it here" switch whenever something plays here. This device is never a
// row among the screens: it is `here` (offered last), and choosing it runs the
// item on the local session itself. A `snapshot` source dispatches in adopt
// mode (hand-off).
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useFleetContext } from "../fleet/useFleetContext.js";
import { useDispatch } from "./useDispatch.js";
import { useCastTarget } from "./useCastTarget.js";
import { useHandOff } from "./useHandOff.js";
import { useControllerSnapshot } from "../controller/useControllerSnapshot.js";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { ClientIdentityContext } from "../identity/ClientIdentityProvider.jsx";
import { describeBusy } from "./castCopy.js";
import mediaLog from "../logging/mediaLog.js";
import { itemKind } from "../habits/mediaHabits.js";
import { canPlayOn } from "../habits/playDestination.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { deviceName } from "../fleet/deviceDisplay.js";
import { executeItemAction } from "../actions/itemAction.js";

/** The `pendingId` of this device's own row while it asks before replacing. */
export const HERE_ID = '__here__';

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
  const snap = useControllerSnapshot(controller);
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
  const localSnap = useControllerSnapshot(local);
  // What plays on this device, from its own session (the fleet's copy lags).
  const localNow = localSnap?.currentItem && LOCAL_ACTIVE_STATES.has(localSnap.state)
    ? { title: localSnap.currentItem.title ?? null, state: localSnap.state }
    : null;
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
  // Move needs exactly one screen. Judged on the screens actually being sent
  // to (a tap sends before React has re-rendered the selection).
  const moveBlockedFor = useCallback((count) => hasPotentialContent && mode === 'transfer' && !asksKeepOrStop
    && !(hasMoveSnapshot && count === 1), [hasPotentialContent, mode, asksKeepOrStop, hasMoveSnapshot]);
  const moveUnavailable = selected.size > 0 && moveBlockedFor(selected.size);

  // What is being sent decides which screens can take it: a film never lists
  // a speaker, and a screen that takes no content is never offered at all.
  // Order is stable — the screen this browser used last for this kind of
  // thing first, then by name — so the screen you want is where it was.
  const { destinationFor, recordPlay } = usePlayDestination();
  const sourceItem = source?.itemAction?.item ?? source?.item
    ?? (source?.getSnapshot ? null : source?.snapshot?.currentItem) ?? null;
  const kind = itemKind(sourceItem);
  const learnedFirst = sourceItem ? destinationFor(sourceItem) : null;
  const preferredIds = learnedFirst && learnedFirst.source !== 'here' ? learnedFirst.targetIds : [];
  const localId = fleet.identity?.deviceId ?? null;
  const isLocalDevice = (device) => device?.isLocal === true || (!!localId && device?.id === localId);
  const playable = (fleet.devices ?? []).filter(device => canPlayOn(device, kind));
  const devices = orderPickerDevices(playable.filter(device => !isLocalDevice(device)), preferredIds);
  // "Usual" is only ever a learned habit, never the current aim.
  const usualIds = learnedFirst?.source === 'learned' ? learnedFirst.targetIds : [];
  // This browser's own name: its fleet row when the bus has it, else the name
  // it was given here (the fleet hears about itself only over the bus).
  const clientIdentity = useContext(ClientIdentityContext);
  const fleetLocal = (fleet.devices ?? []).find(isLocalDevice) ?? null;
  const localDevice = fleetLocal ?? (clientIdentity?.displayName
    ? { id: localId ?? null, name: clientIdentity.displayName, type: 'browser', isLocal: true }
    : null);
  const itemAction = source?.itemAction ?? null;
  const canRunHere = !!itemAction && typeof local?.execute === 'function';
  // This device as a choice: always in the destination sheet; for a one-off
  // send only when it can run the item here (a brief show or a hand-off of
  // what already plays here has nothing to do on this device).
  const here = intent === 'destination'
    ? { device: localDevice }
    : (!source?.brief && !hasMoveSnapshot && (canRunHere || (fleetLocal && playable.some(isLocalDevice))))
      ? { device: localDevice }
      : null;
  const [pendingId, setPendingId] = useState(null);

  // Every mount of this picker IS an "open" — it's only ever rendered while
  // a popover/portal/sheet is showing it (CastButton, NowPlayingView's
  // handoff section, DestinationLine's device sheet). Logged once per open
  // with whatever the fleet offered at that moment.
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  useEffect(() => {
    mediaLog.castSheetOpened({ offeredDeviceIds: devicesRef.current.map((d) => d.id) });
     
  }, []);

  // NF-TAP-10: in single-select every tap is the send. Only replacing what a
  // screen is playing asks first, in the row itself; a brief show returns the
  // screen to its programme and an Add appends, so neither ever replaces.
  const submitRef = useRef(null);
  const replaces = !source?.brief && itemAction?.kind !== 'add' && intent !== 'destination';
  const asksBeforeReplacing = useCallback((entry) => replaces && !!describeBusy(entry), [replaces]);

  // Tap a row: in single mode it sends (or asks to replace); in multi mode it
  // toggles that screen into the selection the confirm button sends.
  const select = useCallback((id) => {
    if (multi) {
      setPendingId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelected(new Set([id]));
    if (pendingId !== id && asksBeforeReplacing(fleet.store?.getEntry?.(id))) {
      setPendingId(id);
      mediaLog.playOnReplaceAsked?.({ targetId: id });
      return;
    }
    setPendingId(null);
    submitRef.current?.([id]);
  }, [multi, pendingId, asksBeforeReplacing, fleet.store]);

  /** The row's own "Play here instead": sends to the screen it asked about. */
  const confirmReplace = useCallback((id) => {
    setPendingId(null);
    if (id === HERE_ID) return hereRef.current?.({ confirmed: true });
    return submitRef.current?.([id]);
  }, []);
  const cancelReplace = useCallback(() => setPendingId(null), []);

  // Leaving multi mode collapses the selection back to one device so the
  // single-select invariant holds.
  const toggleMulti = useCallback(() => {
    setPendingId(null);
    setMulti((wasMulti) => {
      if (wasMulti) setSelected((prev) => new Set([...prev].slice(0, 1)));
      return !wasMulti;
    });
  }, []);

  const canSubmit = selected.size > 0;

  const submit = useCallback(async (idsOverride) => {
    const chosen = Array.isArray(idsOverride) ? idsOverride : Array.from(selected);
    if (chosen.length === 0) return;
    if (moveBlockedFor(chosen.length)) {
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
      // Moving what plays here to a screen is a choice of where it is watched.
      recordPlay(sourceItem ?? snapshot?.currentItem ?? null, targetIds);
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
            params.onConfirmed = () => {
              const result = identity && local?.portability?.stopIfCurrent
                ? local.portability.stopIfCurrent(identity)
                : { ok: false, code: 'NO_IDENTITY' };
              mediaLog.playOnStopHere({ targetIds, ok: result?.ok === true, code: result?.code ?? null });
            };
          }
        }
        dispatchIds = await dispatchToTarget(params);
        // A play chosen on purpose teaches where this kind of thing is watched.
        if (!params.brief && (params.play || params.snapshot)) {
          recordPlay(sourceItem ?? snapshot?.currentItem ?? null, targetIds);
        }
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
  }, [moveBlockedFor, hasMoveSnapshot, selected, mode, source, dispatchToTarget, handOff, onComplete, hasPotentialContent, asksKeepOrStop, local, recordPlay, sourceItem]);

  submitRef.current = submit;

  // This device's row. The destination sheet just aims here; a one-off send
  // runs the item on the local session (what Play here does), asking first
  // when that would replace what plays here. Without a local session that can
  // take it, it falls back to sending to this browser like any screen.
  const hereRef = useRef(null);
  const playHere = useCallback(async ({ confirmed = false } = {}) => {
    if (intent === 'destination') {
      onComplete?.({ targetIds: [], mode });
      return { ok: true };
    }
    const localBusy = replaces && !!localNow;
    if (!confirmed && localBusy) {
      setPendingId(HERE_ID);
      mediaLog.playOnReplaceAsked?.({ targetId: 'local' });
      return { ok: false, pending: true };
    }
    setPendingId(null);
    if (canRunHere) {
      mediaLog.playOnHere({ kind: itemAction.kind, contentId: itemAction.item?.contentId ?? null });
      let result;
      try {
        result = await executeItemAction({ kind: itemAction.kind, item: itemAction.item, collectionItems: itemAction.collectionItems, destination: local });
      } catch (error) {
        result = { ok: false, reason: error?.message };
      }
      if (result?.ok === false) {
        setDispatchError('Could not start it here.');
        return result;
      }
      setDispatchError(null);
      if (itemAction.kind === 'playNow') recordPlay(sourceItem, []);
      onComplete?.({ targetIds: [], mode: 'fork' });
      return result ?? { ok: true };
    }
    if (fleetLocal) return submit([fleetLocal.id]);
    return { ok: false, error: 'no-local' };
  }, [intent, onComplete, mode, fleetLocal, replaces, localNow, canRunHere, itemAction, local, recordPlay, sourceItem, submit]);
  hereRef.current = playHere;

  return {
    devices, selected, multi, mode, asksKeepOrStop, canSubmit, localPlaying, hasPotentialContent, moveSupported, moveUnavailable, dispatchError,
    usualIds, here, pendingId, localNow,
    select, toggleMulti, setMode, submit, playHere, confirmReplace, cancelReplace,
  };
}

/** Preferred ids first (in their order), then everything else by name. */
export function orderPickerDevices(devices, preferredIds = []) {
  const rank = new Map(preferredIds.map((id, index) => [id, index]));
  return [...devices].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
    if (ra !== rb) return ra - rb;
    return deviceName(a).localeCompare(deviceName(b));
  });
}

export default useDispatchTargetPicker;
