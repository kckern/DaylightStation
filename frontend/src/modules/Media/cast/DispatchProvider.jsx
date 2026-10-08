// frontend/src/modules/Media/cast/DispatchProvider.jsx
// The one outcome system for /media (PR-6, RELY.1a–RELY.6a). It owns:
//  - dispatch orchestration: client-side fan-out (one /load per target,
//    independent attempt ids), live wake-progress via homeline:* broadcasts,
//    idempotency dedupe window (C9.8), and retry of the exact attempt (C6.4);
//  - the immutable outcome record per {attemptId, targetId}, far or local
//    (dispatchReducer.js), its Retry / another-screen replay and its Undo;
//  - clearing a "may not have started" notice once that screen itself
//    reports the same item playing (fleet device-state).
// M0 blocks destructive transfer until an owner-qualified handoff exists;
// explicit fork/keep dispatch remains available. Hand-off sends the full
// SessionSnapshot with mode:"adopt" (§4.7).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { parseDeviceTopic, subscribeTopicKind } from '../net/ws.js';
import { reduceDispatch, initialDispatchState, outcomePhase } from './dispatchReducer.js';
import { buildDispatchUrl } from './dispatchUrl.js';
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';
import { PeekContext } from '../peek/PeekContext.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { executeItemAction, createOperationId } from '../actions/itemAction.js';

export const DispatchContext = createContext(null);

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotForRetry(snapshot) {
  // SessionSnapshot is a JSON wire contract. Capture those wire values now,
  // rather than retaining a caller-owned object that can change before Retry.
  return snapshot == null ? snapshot : JSON.parse(JSON.stringify(snapshot));
}

function buildDedupKey({ targetIds, play, queue, mode, shader, volume, shuffle, snapshot, itemAction }) {
  const common = {
    targetIds: [...targetIds].sort(),
    mode: mode ?? 'transfer',
  };

  if (snapshot) {
    return JSON.stringify({
      ...common,
      request: { method: 'POST', mode: 'adopt', snapshot: snapshotForRetry(snapshot) },
    });
  }

  // Match buildDispatchUrl's wire normalization, excluding only dispatchId:
  // it is freshly generated per attempt and therefore cannot define whether
  // two user operations are duplicates.
  return JSON.stringify({
    ...common,
    request: {
      method: 'GET',
      verb: play ? 'play' : 'queue',
      contentId: play || queue,
      shader: shader || null,
      volume: typeof volume === 'number' && Number.isFinite(volume) ? volume : null,
      shuffle: !!shuffle,
      ...(itemAction ? { itemAction: { kind: itemAction.kind, item: itemAction.item, collectionItems: itemAction.collectionItems, clearRest: itemAction.clearRest } } : {}),
      ...(itemAction && !['playNow', 'shuffle'].includes(itemAction.kind) ? { operationId: itemAction.operationId } : {}),
    },
  });
}

export function DispatchProvider({ children }) {
  const [state, dispatch] = useReducer(reduceDispatch, initialDispatchState);
  const peek = useContext(PeekContext);
  const fleet = useContext(FleetContext);
  const fleetStore = fleet?.store ?? null;
  const localController = useContext(LocalSessionContext)?.controller ?? null;
  // The reducer's records are the source of truth; callbacks read them
  // through this mirror so their identities stay stable.
  const recordsRef = useRef(state.byId);
  recordsRef.current = state.byId;
  // Fan-out rows retain independent replay inputs so one failed target can
  // be retried without replaying successful siblings.
  const attemptsRef = useRef(new Map());
  const dedupCacheRef = useRef(new Map());
  const followUpsRef = useRef(new Map());
  // Identical dispatches still IN FLIGHT, keyed the same way as the dedupe
  // cache. The 5s window (C9.8) assumes a dispatch resolves quickly, but a
  // cold LG OLED holds the power step for up to 80s — on 2026-08-12 a user
  // tapped cast three times during one such wait and the window had long
  // since lapsed, so a second full backend dispatch went out and only the
  // BACKEND caught the third. An in-flight duplicate is a duplicate however
  // long it has been running. Kept in a ref, not reducer state, so
  // dispatchToTarget's identity stays stable.
  const inFlightRef = useRef(new Map());
  useEffect(() => {
    return subscribeTopicKind('homeline', (msg) => {
      const { dispatchId, step, status, elapsedMs, error, operation, queueLength, ordinal, count,
        sessionId, ownerId, ownerInstanceId, playbackRevision, queueRevision, appliedAs } = msg;
      const parsedTopic = parseDeviceTopic(msg.topic);
      const topicDeviceId = parsedTopic?.kind === 'homeline' ? parsedTopic.deviceId : null;
      if (typeof dispatchId !== 'string' || !dispatchId) return;
      if (!step || !status) return;
      const attempt = attemptsRef.current.get(dispatchId);
      if (step === 'playback' && status === 'confirmed'
        && attempt?.play && topicDeviceId && attempt.targetIds?.[0] === topicDeviceId
        && (msg.deviceId == null || msg.deviceId === topicDeviceId)
        && ownerId === topicDeviceId
        && typeof sessionId === 'string' && sessionId) {
        peek?.recordConfirmedDispatch?.({
          deviceId: topicDeviceId,
          ownerId,
          playback: {
            sessionId,
            contentId: msg.contentId ?? attempt.play,
            ...(typeof ownerInstanceId === 'string' && ownerInstanceId ? { ownerInstanceId } : {}),
            ...(Number.isInteger(playbackRevision) ? { playbackRevision } : {}),
          },
        });
      }
      mediaLog.dispatchStep({ dispatchId, step, status, elapsedMs });
      if ((step === 'playback' || step === 'queue') && attempt) {
        mediaLog.outcomeResolved({ attemptId: dispatchId, targetId: topicDeviceId ?? attempt.targetIds?.[0] ?? null, step, status });
      }
      dispatch({
        type: 'STEP', dispatchId, step, status, elapsedMs, error, operation, queueLength, ordinal, count,
        sessionId, ownerId, ownerInstanceId, playbackRevision, queueRevision,
        ...(appliedAs ? { appliedAs } : {}),
        // A late step must locate its exact {attemptId, targetId}.
        targetId: topicDeviceId ?? (typeof msg.deviceId === 'string' ? msg.deviceId : undefined),
      });
    });
  }, [peek]);

  // Register a follow-up on an existing dispatch. If that attempt is already
  // confirmed it runs now; if it already failed it is dropped unrun; otherwise
  // it joins any follow-up already waiting on the same attempt.
  const attachFollowUp = (dispatchId, run, deviceId) => {
    const record = recordsRef.current.get(dispatchId);
    const phase = record ? (record.phase ?? outcomePhase(record)) : null;
    if (phase === 'confirmed') {
      try { run({ dispatchId, deviceId }); } catch { /* a follow-up must never break the outcome */ }
      return;
    }
    if (record && ['failed', 'not-sent', 'unconfirmed'].includes(phase)) {
      mediaLog.followUpDropped({ dispatchId, deviceId, phase });
      return;
    }
    const existing = followUpsRef.current.get(dispatchId);
    followUpsRef.current.set(dispatchId, {
      deviceId,
      run: existing ? (arg) => { existing.run(arg); run(arg); } : run,
    });
  };

  const dispatchToTarget = useCallback(async ({ targetIds, play, queue, mode, shader, volume, shuffle, snapshot, title, itemAction, startOver = false, resumedFrom = null, brief = false, onConfirmed = null }, { bypassDedupe = false } = {}) => {
    if (!Array.isArray(targetIds) || targetIds.length === 0) return [];
    if (itemAction && !itemAction.operationId) {
      itemAction = { ...itemAction, operationId: uuid(), tappedAt: Date.now() };
    }
    if (mode === 'transfer') {
      mediaLog.dispatchFailed({
        deviceId: targetIds[0] ?? null,
        contentId: play ?? queue ?? snapshot?.currentItem?.contentId ?? null,
        error: 'move-unsupported',
      });
      return [];
    }

    const key = buildDedupKey({
      targetIds, play, queue, mode, shader, volume, shuffle, snapshot, itemAction,
    }) + (brief ? '|brief' : '');
    const inFlight = inFlightRef.current.get(key);
    const cached = dedupCacheRef.current.get(key);
    const withinWindow = cached && Date.now() - cached.ts < TIMING.DISPATCH_DEDUPE_WINDOW_MS;
    // An explicit retry may bypass the settled-attempt window, but it must
    // never bypass an identical retry that is already in flight.
    if (inFlight?.size || (!bypassDedupe && withinWindow)) {
      const firstDispatchIds = inFlight?.size ? [...inFlight] : cached.dispatchIds;
      mediaLog.dispatchDeduplicated({
        targetIds,
        contentId: play ?? queue ?? 'adopt',
        mode: mode ?? 'transfer',
        reason: inFlight?.size ? 'in-flight' : 'window',
        windowMs: TIMING.DISPATCH_DEDUPE_WINDOW_MS,
        firstDispatchIds,
      });
      // A Move deduped onto an earlier identical start must still stop here
      // once that start confirms — never silently degrade to Keep.
      if (typeof onConfirmed === 'function' && firstDispatchIds[0]) {
        attachFollowUp(firstDispatchIds[0], onConfirmed, targetIds[0]);
      }
      return firstDispatchIds;
    }

    // Undo rides the outcome itself, offered at tap time while the owner's
    // ACK is still outstanding (RELY.4a); it is not a second voice.
    const undo = itemAction ? {
      operationId: itemAction.operationId,
      expiresAt: itemAction.tappedAt + 10000,
      run: async operationId => {
        const results = await Promise.all(targetIds.map(id => peek?.getController?.(id)?.undo(operationId) ?? { ok: false, code: 'ITEM_ACTION_UNSUPPORTED' }));
        return results.find(result => !result?.ok) ?? { ok: true };
      },
    } : null;

    const isAdopt = !!snapshot;
    const contentId = play ?? queue ?? (isAdopt ? (snapshot?.currentItem?.contentId ?? 'adopt-snapshot') : null);
    // Human content title for the tray (additive — callers that don't pass
    // one degrade to no title, never to a raw content id in the UI).
    const contentTitle = title ?? snapshot?.currentItem?.title ?? null;
    const dispatchIds = [];
    const retrySnapshot = snapshotForRetry(snapshot);
    const settle = (dispatchId) => {
      const set = inFlightRef.current.get(key);
      if (!set) return;
      set.delete(dispatchId);
      if (set.size === 0) inFlightRef.current.delete(key);
    };
    inFlightRef.current.set(key, new Set());

    for (const deviceId of targetIds) {
      const dispatchId = uuid();
      dispatchIds.push(dispatchId);
      inFlightRef.current.get(key)?.add(dispatchId);
      // A follow-up (e.g. "Move: stop playing here") runs only once that screen
      // CONFIRMS playing — never on the mere acceptance of the request.
      if (typeof onConfirmed === 'function') followUpsRef.current.set(dispatchId, { run: onConfirmed, deviceId });
      attemptsRef.current.set(dispatchId, {
        targetIds: [deviceId], play, queue, mode, shader, volume, shuffle, snapshot: retrySnapshot, title, itemAction,
        ...(brief ? { brief: true } : {}),
      });
      dispatch({
        type: 'INITIATED', dispatchId, deviceId, contentId, title: contentTitle,
        mode: mode ?? 'transfer', operation: queue ? 'add' : 'play-now',
        command: { targetIds: [deviceId], play, queue, mode, shader, volume, shuffle, snapshot: retrySnapshot, title, itemAction },
        snapshot: retrySnapshot,
        undo,
        ...(startOver ? { startOver: true, resumedFrom } : {}),
      });
      mediaLog.dispatchInitiated({ dispatchId, deviceId, contentId, mode });
      mediaLog.outcomeRecorded({ attemptId: dispatchId, targetId: deviceId, kind: queue ? 'add' : (isAdopt ? 'move' : 'play'), phase: 'running', contentId });

      const httpPromise = isAdopt
        ? DaylightAPI(`api/v1/device/${deviceId}/load`, { dispatchId, snapshot, mode: 'adopt' }, 'POST')
        : DaylightAPI(buildDispatchUrl({ deviceId, play, queue, dispatchId, shader, volume, shuffle, itemAction, brief, title: brief ? contentTitle : null, manualRetryOnly: true }));
      httpPromise
        .then((res) => {
          settle(dispatchId);
          if (res?.ok) {
            dispatch({ type: 'SUCCEEDED', dispatchId, totalElapsedMs: res.totalElapsedMs ?? null, ...(res.appliedAs ? { appliedAs: res.appliedAs } : {}) });
            mediaLog.dispatchSucceeded({ dispatchId, totalElapsedMs: res.totalElapsedMs });
          } else {
            // Failure must not poison the idempotency cache — the user's
            // retry within the window has to actually re-dispatch (C6.4).
            dedupCacheRef.current.delete(key);
            dispatch({
              type: 'FAILED', dispatchId,
              error: res?.error ?? 'unknown',
              failedStep: res?.failedStep ?? null,
            });
            mediaLog.dispatchFailed({ dispatchId, failedStep: res?.failedStep, error: res?.error });
          }
        })
        .catch((err) => {
          settle(dispatchId);
          dedupCacheRef.current.delete(key);
          dispatch({ type: 'FAILED', dispatchId, error: err?.message ?? 'network-error', failedStep: null });
          mediaLog.dispatchFailed({ dispatchId, error: err?.message });
        });
    }

    dedupCacheRef.current.set(key, { ts: Date.now(), dispatchIds });
    return dispatchIds;
  }, [peek]);

  const retry = useCallback((attemptId) => {
    const record = recordsRef.current.get(attemptId);
    if (record && record.distance !== 'far') {
      // A local or direct record's Retry replays exactly that command at
      // exactly that screen (a playback problem replays its item there).
      const item = record.command?.item ?? record.item;
      const kind = record.kind === 'playback' ? 'playNow' : (record.command?.kind ?? 'playNow');
      mediaLog.outcomeRetried({ attemptId, targetId: record.targetId, contentId: item?.contentId ?? null });
      const destination = record.targetId === 'local' ? localController : peek?.getController?.(record.targetId);
      if (!destination?.execute || !item?.contentId) return [];
      // The replay replaces the failed record (review c).
      dispatch({ type: 'REMOVED', dispatchId: attemptId });
      return executeItemAction({ kind, item: { ...item }, destination, operationId: createOperationId() })
        .then(() => [], () => []);
    }
    const attempt = attemptsRef.current.get(attemptId);
    if (!attempt) return [];
    mediaLog.outcomeRetried({ attemptId, targetId: attempt.targetIds?.[0] ?? null, contentId: attempt.play ?? attempt.queue ?? null });
    const replay = dispatchToTarget(attempt, { bypassDedupe: true });
    // Retire the record Retry replayed once the new attempt is initiated.
    attemptsRef.current.delete(attemptId);
    dispatch({ type: 'REMOVED', dispatchId: attemptId });
    return replay;
  }, [dispatchToTarget, localController, peek]);

  // RELY.6a/AC2: the same attempt, sent to another chosen screen instead.
  const sendElsewhere = useCallback((attemptId, targetId) => {
    if (typeof targetId !== 'string' || !targetId) return [];
    const record = recordsRef.current.get(attemptId);
    const attempt = attemptsRef.current.get(attemptId);
    const fromTarget = record?.targetId ?? attempt?.targetIds?.[0] ?? null;
    if (attempt) {
      mediaLog.outcomeSentElsewhere({ attemptId, fromTargetId: fromTarget, targetId });
      return dispatchToTarget({ ...attempt, targetIds: [targetId], mode: attempt.mode === 'transfer' ? 'fork' : attempt.mode }, { bypassDedupe: true });
    }
    const item = record?.command?.item ?? record?.item;
    if (!item?.contentId) return [];
    mediaLog.outcomeSentElsewhere({ attemptId, fromTargetId: fromTarget, targetId });
    return dispatchToTarget({ targetIds: [targetId], play: item.contentId, mode: 'fork', title: item.title ?? undefined }, { bypassDedupe: true });
  }, [dispatchToTarget]);

  // O1: after its undo window, a far start still waking/loading can be
  // stopped from this device. Stop keeps that screen's queue (RQ-STEER-10)
  // and touches only this attempt's target.
  const stopAttempt = useCallback(async (attemptId) => {
    const record = recordsRef.current.get(attemptId);
    const targetId = record?.targetId ?? attemptsRef.current.get(attemptId)?.targetIds?.[0] ?? null;
    if (!targetId || record?.distance !== 'far') return { ok: false, code: 'NO_TARGET' };
    mediaLog.outcomeStopped({ attemptId, targetId, phase: record.phase });
    const controller = peek?.getController?.(targetId);
    if (!controller?.transport?.stop) return { ok: false, code: 'UNSUPPORTED' };
    try {
      const result = await controller.transport.stop({ keepMusic: false });
      dispatch({ type: 'REMOVED', dispatchId: attemptId });
      return result ?? { ok: true };
    } catch (error) {
      mediaLog.outcomeStopFailed({ attemptId, targetId, error: error?.message ?? String(error) });
      return { ok: false, error: error?.message };
    }
  }, [peek]);

  // RELY.5a: Skip now on a local item the Player is waiting on.
  const skipLocal = useCallback((attemptId) => {
    mediaLog.outcomeSkipped?.({ attemptId, targetId: 'local' });
    localController?.transport?.skipNext?.();
    dispatch({ type: 'REMOVED', dispatchId: attemptId });
  }, [localController]);

  const removeDispatch = useCallback((attemptId) => {
    const record = recordsRef.current.get(attemptId);
    if (record) mediaLog.outcomeDismissed({ attemptId, targetId: record.targetId, phase: record.phase });
    attemptsRef.current.delete(attemptId);
    dispatch({ type: 'REMOVED', dispatchId: attemptId });
  }, []);

  // Local outcomes: this device's own plays, adds, queue edits and playback
  // problems, through the same records as far screens.
  const recordLocal = useCallback(({ attemptId = uuid(), kind, phase = 'confirmed', item, command = null, reason = null, replacement = null, undo = null, ordinal = null, count = null, targetId = 'local', targetName = null, startOver = false, resumedFrom = null } = {}) => {
    dispatch({ type: 'LOCAL', attemptId, kind, phase, item, command, reason, replacement, undo, ordinal, count, targetId, targetName, startOver, resumedFrom });
    mediaLog.outcomeRecorded({ attemptId, targetId, kind, phase, contentId: item?.contentId ?? null, reason });
    return attemptId;
  }, []);

  const resolveLocal = useCallback((attemptId, { phase, reason = null, ordinal = null, count = null } = {}) => {
    if (!attemptId || !phase) return;
    dispatch({ type: 'LOCAL_RESOLVED', attemptId, phase, reason, ordinal, count });
    mediaLog.outcomeResolved({ attemptId, targetId: recordsRef.current.get(attemptId)?.targetId ?? 'local', phase, reason });
  }, []);

  // PLAY.4a: Start over on the confirmation of a play that continued from a
  // saved spot restarts the current item on exactly that screen.
  const startOver = useCallback(async (attemptId) => {
    const record = recordsRef.current.get(attemptId);
    if (!record?.startOver) return { ok: false, code: 'NOT_RESUMED' };
    const targetId = record.targetId ?? record.deviceId;
    const controller = targetId === 'local' ? localController : peek?.getController?.(targetId);
    mediaLog.outcomeStartOver({ attemptId, targetId, contentId: record.item?.contentId ?? null });
    try {
      if (targetId === 'local') {
        // Replay the item here from 0 with no server resume. A seek would be
        // lost while the item is still loading: the Player applies its
        // pending start offset when the media arrives.
        const item = record.command?.item ?? record.item;
        if (!controller?.execute || !item?.contentId) return { ok: false, code: 'UNSUPPORTED' };
        const result = await executeItemAction({
          kind: 'playNow', item: { ...item, seconds: 0, resume: false }, destination: controller, operationId: createOperationId(),
        });
        if (result?.ok === false) throw new Error(result.reason ?? result.code ?? 'Could not start over');
        dispatch({ type: 'REMOVED', dispatchId: attemptId });
        const startedId = uuid();
        dispatch({ type: 'LOCAL', attemptId: startedId, kind: 'startOver', phase: 'confirmed', item: { contentId: item.contentId, title: item.title ?? record.item?.title ?? null } });
        return { ok: true };
      }
      if (!controller?.transport?.restartCurrent) return { ok: false, code: 'UNSUPPORTED' };
      await controller.transport.restartCurrent();
      dispatch({ type: 'REMOVED', dispatchId: attemptId });
      dispatch({ type: 'LOCAL', attemptId: uuid(), kind: 'startOver', phase: 'confirmed', targetId,
        item: { contentId: record.item?.contentId ?? null, title: record.item?.title ?? record.title ?? null } });
      return { ok: true };
    } catch (error) {
      mediaLog.outcomeStartOverFailed({ attemptId, targetId, error: error?.message ?? String(error) });
      return { ok: false, error: error?.message };
    }
  }, [localController, peek]);

  // RELY.3a/AC4: an unconfirmed start clears once that screen reports the
  // same item playing. Reads the fleet store directly so a state that was
  // already playing when the watchdog timed out also clears it.
  const reconcileScreens = useCallback(() => {
    if (!fleetStore) return;
    for (const record of recordsRef.current.values()) {
      if (record.distance === 'here' || outcomePhase(record) !== 'unconfirmed') continue;
      const entry = fleetStore.getEntry(record.targetId);
      const snapshot = entry?.snapshot;
      if (!snapshot || entry.offline || entry.isStale) continue;
      const contentId = snapshot.currentItem?.contentId ?? null;
      if (snapshot.state !== 'playing' || !contentId || contentId !== record.item?.contentId) continue;
      mediaLog.outcomeCleared({ attemptId: record.attemptId, targetId: record.targetId, contentId, reason: 'screen-reported-playing' });
      dispatch({ type: 'SCREEN_STATE', targetId: record.targetId, state: snapshot.state, contentId });
    }
  }, [fleetStore]);

  useEffect(() => {
    if (!fleetStore?.subscribeAll) return undefined;
    return fleetStore.subscribeAll(() => reconcileScreens());
  }, [fleetStore, reconcileScreens]);
  useEffect(() => { reconcileScreens(); }, [state.byId, reconcileScreens]);

  // Follow-ups wait for their own attempt to be CONFIRMED playing; an attempt
  // that fails, goes unconfirmed or vanishes drops its follow-up unrun, so
  // whatever it would have changed here is left exactly as it was.
  useEffect(() => {
    for (const [dispatchId, followUp] of [...followUpsRef.current]) {
      const record = state.byId.get(dispatchId);
      const phase = record ? (record.phase ?? outcomePhase(record)) : null;
      if (phase === 'confirmed') {
        followUpsRef.current.delete(dispatchId);
        try { followUp.run({ dispatchId, deviceId: followUp.deviceId }); } catch { /* a follow-up must never break the outcome */ }
      } else if (!record || ['failed', 'not-sent', 'unconfirmed'].includes(phase)) {
        followUpsRef.current.delete(dispatchId);
        mediaLog.followUpDropped({ dispatchId, deviceId: followUp.deviceId, phase });
      }
    }
  }, [state.byId]);

  // Replay inputs live only as long as their record (review d): a record the
  // reducer superseded or removed can never be replayed afterwards.
  useEffect(() => {
    for (const id of attemptsRef.current.keys()) {
      if (!state.byId.has(id)) attemptsRef.current.delete(id);
    }
  }, [state.byId]);

  const value = useMemo(
    () => ({
      dispatches: state.byId,
      outcomes: state.byId,
      dispatchToTarget, retry, sendElsewhere, removeDispatch, recordLocal, resolveLocal, stopAttempt, skipLocal, startOver,
    }),
    [state.byId, dispatchToTarget, retry, sendElsewhere, removeDispatch, recordLocal, resolveLocal, stopAttempt, skipLocal, startOver]
  );

  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>;
}

export default DispatchProvider;
