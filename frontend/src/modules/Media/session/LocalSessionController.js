// frontend/src/modules/Media/session/LocalSessionController.js
// The local half of the controller symmetry seam (controllerShape.js): a thin
// facade composing the session store, the pure queue/advancement modules, the
// hot position channel, and the player handle injected by PlayerBridge.
// It holds no state of its own.
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import {
  preparePlaybackOwnerAdoption,
  samePlaybackOwnerIdentity,
} from '@shared-contracts/media/playback-owner.mjs';
import { createSessionStore } from './sessionStore.js';
import { createPositionChannel } from './positionChannel.js';
import * as qOps from './queueOps.js';
import { pickNextQueueItem } from './advancement.js';
import { isContainerInput, expandContainerInput } from './containerExpansion.js';
import mediaLog from '../logging/mediaLog.js';
import { createItemActionOwner } from '../actions/itemActionOwner.js';

function defaultUuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function itemFromQueueEntry(entry) {
  return {
    contentId: entry.contentId,
    format: entry.format,
    title: entry.title,
    duration: entry.duration,
    thumbnail: entry.thumbnail,
    // Display context must survive the LOAD_ITEM round-trip, or currentItem
    // loses the show/album and artist/album that queueOps put on the entry.
    // NowPlayingView reads the entry first today, but pinning the invariant
    // here keeps a future refactor that reads currentItem from silently
    // dropping the context line (the round-2 whitelist bug, third copy).
    ...(entry.containerTitle != null ? { containerTitle: entry.containerTitle } : {}),
    ...(entry.artist != null ? { artist: entry.artist } : {}),
    ...(entry.album != null ? { album: entry.album } : {}),
    ...(entry.mediaType != null ? { mediaType: entry.mediaType } : {}),
    ...(entry.isLive != null ? { isLive: !!entry.isLive } : {}),
  };
}

function observedItemPatch(observation = {}) {
  const { duration, media } = observation;
  const patch = {};
  const source = media && typeof media === 'object' ? media : {};
  for (const key of ['format', 'mediaType', 'title', 'thumbnail']) {
    if (source[key] != null) patch[key] = source[key];
  }
  if (typeof source.isLive === 'boolean') patch.isLive = source.isLive;
  if (source.isLive === true) patch.duration = null;
  else {
    const hasObservedDuration = Object.prototype.hasOwnProperty.call(observation, 'duration');
    const hasMediaDuration = Object.prototype.hasOwnProperty.call(source, 'duration');
    if (hasObservedDuration || hasMediaDuration) {
      const observedDuration = hasObservedDuration ? duration : source.duration;
      patch.duration = typeof observedDuration === 'number'
        && Number.isFinite(observedDuration)
        && observedDuration > 0
        ? observedDuration
        : null;
    }
  }
  return patch;
}

export function createLocalSessionController({
  clientId,
  persistedSnapshot = null,
  randomUuid = defaultUuid,
  ownerInstanceId = `local-owner:${defaultUuid()}`,
  nowFn = () => new Date(),
  clearPersisted = () => {},
  fetchImpl = undefined, // container expansion; defaults to globalThis.fetch
} = {}) {
  // RELY.7a: a restored session comes back PAUSED, never playing aloud. The
  // Player is held unmounted (PlayerBridge) until an explicit start.
  const RESTORE_ACTIVE_STATES = new Set(['playing', 'buffering', 'stalled', 'loading']);
  const restoredPaused = persistedSnapshot?.currentItem && RESTORE_ACTIVE_STATES.has(persistedSnapshot.state)
    ? { ...persistedSnapshot, state: 'paused' }
    : persistedSnapshot;
  const restored = restoredPaused ?? createIdleSessionSnapshot({
    sessionId: randomUuid(),
    ownerId: clientId,
    now: nowFn(),
  });
  let canonicalRevision = Number.isInteger(restored.meta?.revision) ? restored.meta.revision : 0;
  // `pendingOrigin` is the ambient "origin for the next SYNCHRONOUS transition"
  // — correct only when staging and consuming happen back-to-back in the same
  // synchronous call. It is NOT reliable across an `await`/microtask boundary,
  // because a second, unrelated command can run (and stage its own origin, or
  // clear this one) before the first command's deferred transition arrives.
  // `operationOrigins` captures an async operation's origin explicitly, at
  // the moment it begins (item-actions/undos are already keyed by an
  // `operationId` from the command envelope), so its eventual transition is
  // stamped correctly regardless of what else runs in the meantime.
  //
  // Transport actions (play/pause/seek) are NOT async in this sense — their
  // provenance question is simply "who last commanded this screen," answered
  // SYNCHRONOUSLY at command time (see transport.play/pause/seekAbs below),
  // not by waiting for the player to report back. An earlier design armed a
  // single-shot "expected transition" ticket consumed by the next matching
  // player-driven dispatch; it was removed (three real failure modes: a
  // no-op PLAYER_OBSERVATION — timeupdate/durationchange with no actual
  // state change — still burned the ticket before the real event, since the
  // action object (and the ticket-consuming call baked into it) is built
  // before the reducer ever decides the dispatch is a no-op; seekAbs armed a
  // ticket nothing was ever guaranteed to consume; and the ticket survived
  // across LOAD_ITEM/skip, so the NEXT item's first 'playing' could still be
  // wrongly stamped with a stale origin). Player-driven dispatches
  // (PLAYER_STATE/PLAYER_OBSERVATION/progress UPDATE_POSITION, flagged
  // `__playerDriven`) now never touch meta.origin at all — nor read or clear
  // a staged `pendingOrigin` — so provenance is sticky until the next actual
  // command, by design.
  let pendingOrigin = null;
  const operationOrigins = new Map();
  const initial = {
    ...restored,
    meta: { ...restored.meta, revision: canonicalRevision },
  };
  const store = createSessionStore(initial);

  // ---- Restore hold (RELY.7a) ----
  let restoreHeld = !!initial.currentItem && !!persistedSnapshot;
  const restoreListeners = new Set();
  const releaseRestore = (reason) => {
    if (!restoreHeld) return;
    restoreHeld = false;
    mediaLog.sessionRestoreReleased({ sessionId: store.getSnapshot().sessionId, reason });
    for (const fn of [...restoreListeners]) fn(false);
  };
  if (restoreHeld) {
    mediaLog.sessionRestoredPaused({
      sessionId: initial.sessionId,
      contentId: initial.currentItem.contentId,
      position: initial.position ?? 0,
      queueLength: initial.queue?.items?.length ?? 0,
    });
  }
  // Anything that starts different playback ends the hold too.
  store.onTransition((_prev, _next, action) => {
    if (['LOAD_ITEM', 'SET_CURRENT_ITEM', 'ADOPT_SNAPSHOT', 'RESET', 'STOP'].includes(action?.type)) {
      releaseRestore(String(action.type).toLowerCase());
    }
  });

  // ---- Local playback problems (RELY.5a) ----
  let problem = null;
  const problemListeners = new Set();
  const setProblem = (next) => {
    problem = next;
    for (const fn of [...problemListeners]) fn(problem);
  };
  const raiseProblem = (failedItem, reason) => {
    const afterSnap = store.getSnapshot();
    const after = afterSnap.state === 'ended' ? null : afterSnap.currentItem;
    const sameVisit = after && (after.queueItemId && failedItem.queueItemId
      ? after.queueItemId === failedItem.queueItemId
      : after === failedItem);
    const replacement = after && after.contentId && !sameVisit
      ? { contentId: after.contentId, title: after.title ?? null, queueItemId: after.queueItemId ?? null }
      : null;
    const next = {
      kind: replacement ? 'skipped' : 'failed',
      reason,
      item: { contentId: failedItem.contentId, title: failedItem.title ?? null, queueItemId: failedItem.queueItemId ?? null },
      replacement,
      at: Date.now(),
    };
    mediaLog.playbackProblem({
      sessionId: store.getSnapshot().sessionId,
      kind: next.kind, reason, contentId: failedItem.contentId,
      replacementContentId: replacement?.contentId ?? null,
    });
    setProblem(next);
  };
  // ---- Refused-source waits (RELY.5a ruling) ----
  // The Player waits out a file the server refuses to read (Media caps that
  // wait at 60 s). A wait longer than 3 s shows as `waiting`; if the item
  // after a "file unavailable" skip also waits within 60 s, the library is
  // probably down: hold on it with one `library-unavailable` problem instead
  // of skipping through the whole queue.
  const SOURCE_WAIT_NOTICE_MS = 3_000;
  const SOURCE_STORM_WINDOW_MS = 60_000;
  let sourceWaitTimer = null;
  let lastSourceSkipAt = null;
  let holdContentId = null;
  const clearSourceWaitTimer = () => {
    if (sourceWaitTimer) { clearTimeout(sourceWaitTimer); sourceWaitTimer = null; }
  };
  const problemItem = (item) => ({ contentId: item.contentId, title: item.title ?? null, queueItemId: item.queueItemId ?? null });
  const raiseHeldProblem = (kind, item) => {
    const next = { kind, reason: 'source-unavailable', item: problemItem(item), replacement: null, at: Date.now() };
    mediaLog.playbackProblem({ sessionId: store.getSnapshot().sessionId, kind, reason: 'source-unavailable', contentId: item.contentId, replacementContentId: null });
    setProblem(next);
  };
  store.onTransition((_prev, _next, action) => {
    if (['LOAD_ITEM', 'SET_CURRENT_ITEM', 'ADOPT_SNAPSHOT', 'RESET', 'STOP'].includes(action?.type)) {
      clearSourceWaitTimer();
      const current = store.getSnapshot().currentItem;
      if (holdContentId && current?.contentId !== holdContentId) holdContentId = null;
    }
  });

  const clearProblem = (reason) => {
    if (!problem) return;
    mediaLog.playbackRecovered({ sessionId: store.getSnapshot().sessionId, contentId: problem.item.contentId, reason });
    setProblem(null);
  };
  const position = createPositionChannel();
  position.set(initial.position ?? 0);
  let playbackRevision = 0;
  let queueRevision = 0;
  let itemActionGuardRevision = 0;
  let stopRevision = 0;
  let observedNativeNode = null;
  let nativeBinding = null;
  let nativeNodeGeneration = 0;
  let nativePlayingObserved = false;
  let nativeAdvancedObserved = false;
  let nativeSawOperationSeeking = false;
  let nativeTargetSeekedObserved = false;
  let nativeLastTime = null;
  const nativeListeners = new Set();

  const queueFingerprint = (snapshot) => JSON.stringify({
    items: snapshot.queue?.items?.map((item) => ({
      queueItemId: item.queueItemId,
      contentId: item.contentId,
      priority: item.priority,
    })) ?? [],
    currentIndex: snapshot.queue?.currentIndex ?? -1,
    executionOrder: snapshot.queue?.executionOrder ?? null,
    config: snapshot.config,
  });

  // A DELIBERATELY NARROWER cousin of queueFingerprint, used ONLY to feed
  // the item-action ledger's own supersede guard (via the `revision`
  // callback passed to createItemActionOwner below) — NOT `queueRevision`
  // itself, which is a first-class field of the cross-controller ownership
  // identity (shared/contracts/media/playback-owner.mjs's
  // samePlaybackOwnerIdentity/IDENTITY_FIELDS) used for handoff/portability
  // comparisons well beyond this guard. Widening queueFingerprint's
  // sensitivity would have changed THAT meaning too, which is out of scope
  // here. `config.volume`/`config.shader` change neither what the queue
  // contains nor its order, so they should not cancel a still-expanding
  // "Play now" underneath the person who tapped it; `shuffle`/`repeat`
  // genuinely change what plays next, so they still count.
  const itemActionFingerprint = (snapshot) => JSON.stringify({
    items: snapshot.queue?.items?.map((item) => ({
      queueItemId: item.queueItemId,
      contentId: item.contentId,
      priority: item.priority,
    })) ?? [],
    currentIndex: snapshot.queue?.currentIndex ?? -1,
    executionOrder: snapshot.queue?.executionOrder ?? null,
    config: { shuffle: snapshot.config?.shuffle, repeat: snapshot.config?.repeat },
  });

  // Revisions change at the owner action boundary. Metadata/position updates
  // are deliberately absent so an enrichment cannot invalidate a move guard.
  store.onTransition((prev, next, action) => {
    canonicalRevision += 1;
    // An explicit per-operation stamp (see above) always wins over the
    // ambient value — it is how a deferred transition survives another
    // command running in between.
    //
    // Player-driven dispatches (`__playerDriven`: PLAYER_STATE,
    // PLAYER_OBSERVATION, progress UPDATE_POSITION) neither read nor clear
    // the ambient `pendingOrigin`. A player event is never a command's
    // outcome: stamping it with whatever happens to be staged (e.g. a
    // player callback fired synchronously inside a command's mutate(),
    // before applyWithOrigin clears) would change provenance for something
    // no one commanded, and consuming it would rob the command's own
    // synchronous tail of its origin. Flagged per
    // dispatch rather than by action type, because the same types are also
    // dispatched from command paths (pause's durable position flush,
    // skipNext's end-of-queue PLAYER_STATE) that must keep stamping.
    const playerDriven = action?.__playerDriven === true;
    const stampOrigin = action?.__opOrigin ?? (playerDriven ? null : pendingOrigin);
    next.meta = {
      ...next.meta,
      revision: canonicalRevision,
      ...(stampOrigin ? { origin: stampOrigin } : {}),
    };
    if (!playerDriven) pendingOrigin = null;
    if (['STOP', 'RESET'].includes(action?.type)) stopRevision += 1;
    if (action?.type === 'ADOPT_SNAPSHOT' || queueFingerprint(prev) !== queueFingerprint(next)) {
      queueRevision += 1;
    }
    if (action?.type === 'ADOPT_SNAPSHOT' || itemActionFingerprint(prev) !== itemActionFingerprint(next)) {
      itemActionGuardRevision += 1;
    }
    if (['LOAD_ITEM', 'ADOPT_SNAPSHOT', 'STOP', 'RESET'].includes(action?.type)) {
      playbackRevision += 1;
    }
  });

  // PlayerBridge injects the imperative player surface; until it does (or
  // when no media element exists) these are no-ops.
  let player = {
    play: () => {}, pause: () => {}, seek: () => {}, setPlaybackRate: () => {}, setShader: () => {},
    getMediaElement: () => null,
  };

  const snap = () => store.getSnapshot();
  const defaultOrigin = () => ({ kind: 'device', id: `browser:${clientId}` });
  const beginAction = () => {
    if (!pendingOrigin) pendingOrigin = defaultOrigin();
  };
  // "Who last commanded this screen" — dispatched synchronously by transport
  // actions whose own effect otherwise produces no transition of its own
  // (see transport.play/pause/seekAbs below), so provenance is stamped at
  // command time rather than waiting for a player event that may never
  // arrive, may arrive out of order, or may arrive for the WRONG reason
  // (see the removed-ticket note above). `SET_ORIGIN`'s reducer case is
  // meta-only (sessionReducer.js) and always commits, so this never
  // silently no-ops.
  const stampOrigin = (origin) => {
    store.dispatch({ type: 'SET_ORIGIN', origin, __opOrigin: origin });
  };

  const currentIdentity = (snapshot = snap()) => {
    const items = snapshot.queue?.items ?? [];
    const currentIndex = snapshot.queue?.currentIndex ?? -1;
    const currentEntry = currentIndex >= 0 ? items[currentIndex] : null;
    return {
      ownerInstanceId,
      playbackRevision,
      queueRevision,
      sessionId: snapshot.sessionId,
      contentId: currentEntry?.contentId ?? null,
      queueItemId: currentEntry?.queueItemId ?? null,
    };
  };

  const nativeError = (node) => node?.error
    ? { code: node.error.code ?? null, message: node.error.message ?? null }
    : null;

  const bindNativeObservation = (node, resolvedContentId = null, resolvedGeneration = null, operationBinding = null) => {
    const nextNode = node && typeof node === 'object' ? node : null;
    const nextContentId = resolvedContentId == null ? null : String(resolvedContentId);
    if (nativeBinding
      && nativeBinding.node === nextNode
      && nativeBinding.resolvedContentId === nextContentId
      && nativeBinding.resolvedGeneration === resolvedGeneration
      && (!operationBinding || (
        nativeBinding.operationId === operationBinding.operationId
        && nativeBinding.rendererToken === operationBinding.rendererToken
        && nativeBinding.targetSeconds === (Number.isFinite(operationBinding.targetSeconds)
          ? operationBinding.targetSeconds
          : null)
      ))) return;
    if (observedNativeNode !== nextNode) {
      observedNativeNode = nextNode;
      playbackRevision += 1;
    }
    nativeNodeGeneration += 1;
    nativeBinding = nextNode ? {
      node: nextNode,
      resolvedContentId: nextContentId,
      resolvedGeneration,
      nodeGeneration: nativeNodeGeneration,
      ownerPlaybackRevision: playbackRevision,
      operationId: operationBinding?.operationId ?? null,
      rendererToken: operationBinding?.rendererToken ?? null,
      targetSeconds: Number.isFinite(operationBinding?.targetSeconds)
        ? operationBinding.targetSeconds
        : null,
    } : null;
    nativePlayingObserved = false;
    nativeAdvancedObserved = false;
    nativeSawOperationSeeking = false;
    nativeTargetSeekedObserved = false;
    nativeLastTime = Number.isFinite(nextNode?.currentTime) ? nextNode.currentTime : null;
  };

  const ensureNativeBinding = () => {
    const node = player.getMediaElement?.() ?? null;
    const resolved = player.getMountedContentId?.() ?? null;
    const resolvedGeneration = player.getMountedMediaGeneration?.() ?? null;
    bindNativeObservation(node, resolved, resolvedGeneration);
    return node;
  };

  const getNativeObservation = () => {
    const node = ensureNativeBinding();
    if (!node || !nativeBinding || nativeBinding.node !== node) return null;
    const current = snap();
    const identity = currentIdentity(current);
    const matchesCurrent = identity.contentId != null
      && nativeBinding.resolvedContentId != null
      && String(identity.contentId) === nativeBinding.resolvedContentId
      && nativeBinding.ownerPlaybackRevision === playbackRevision;
    return {
      node,
      nodeGeneration: nativeBinding.nodeGeneration,
      resolvedContentId: nativeBinding.resolvedContentId,
      resolvedGeneration: nativeBinding.resolvedGeneration,
      operationId: nativeBinding.operationId,
      rendererToken: nativeBinding.rendererToken,
      identity: matchesCurrent ? { ...identity } : null,
      currentTime: Number.isFinite(node.currentTime) ? node.currentTime : 0,
      duration: Number.isFinite(node.duration) && node.duration > 0 ? node.duration : null,
      readyState: Number.isInteger(node.readyState) ? node.readyState : 0,
      paused: Boolean(node.paused),
      seeking: Boolean(node.seeking),
      ended: Boolean(node.ended),
      error: nativeError(node),
      playingObserved: nativePlayingObserved,
      advancedObserved: nativeAdvancedObserved,
      targetSeekedObserved: nativeTargetSeekedObserved,
    };
  };

  const emitNativeObservation = () => {
    const observation = getNativeObservation();
    if (!observation) return;
    for (const listener of [...nativeListeners]) {
      try { listener(observation); } catch { /* observer isolation */ }
    }
  };

  const onNativeObservationEvent = (node, type) => {
    if (!nativeBinding || nativeBinding.node !== node) return;
    if (nativeBinding.ownerPlaybackRevision !== playbackRevision) return;
    if (player.getMediaElement?.() !== node) return;
    const resolved = player.getMountedContentId?.() ?? null;
    if (String(resolved ?? '') !== String(nativeBinding.resolvedContentId ?? '')) return;
    if (type === 'playing') {
      nativePlayingObserved = true;
      nativeAdvancedObserved = false;
      nativeLastTime = Number.isFinite(node.currentTime) ? node.currentTime : null;
    }
    if (type === 'seeking' && nativeBinding.operationId && nativeBinding.targetSeconds > 0) {
      nativeSawOperationSeeking = true;
      nativeTargetSeekedObserved = false;
      nativeAdvancedObserved = false;
    }
    if (type === 'seeked' && nativeSawOperationSeeking && nativeBinding.operationId
      && nativeBinding.targetSeconds > 0
      && Number.isFinite(node.currentTime)
      && Math.abs(node.currentTime - nativeBinding.targetSeconds) <= 0.75) {
      nativeTargetSeekedObserved = true;
      // Positive-target qualification requires a playing event after seek
      // completion, not one delivered while the seek was still in flight.
      nativePlayingObserved = false;
      nativeAdvancedObserved = false;
    }
    if (['pause', 'waiting', 'seeking', 'ended', 'error'].includes(type)) nativePlayingObserved = false;
    if (type === 'timeupdate' || type === 'progress') {
      const current = Number.isFinite(node.currentTime) ? node.currentTime : null;
      if (nativePlayingObserved && current != null && nativeLastTime != null && current > nativeLastTime) {
        nativeAdvancedObserved = true;
      }
      nativeLastTime = current;
    }
    emitNativeObservation();
  };

  const capture = () => {
    const current = snap();
    const native = ensureNativeBinding();
    const currentEntry = current.queue?.items?.[current.queue?.currentIndex] ?? null;
    const nativeMatchesCurrent = native
      && nativeBinding?.node === native
      && nativeBinding.resolvedContentId != null
      && String(currentEntry?.contentId ?? '') === nativeBinding.resolvedContentId
      && nativeBinding.ownerPlaybackRevision === playbackRevision;
    const nativePosition = nativeMatchesCurrent ? native.currentTime : null;
    const hotPosition = Number.isFinite(nativePosition) && nativePosition >= 0
      ? nativePosition
      : position.get().seconds;
    const snapshot = JSON.parse(JSON.stringify(current));
    snapshot.position = Number.isFinite(hotPosition) && hotPosition >= 0 ? hotPosition : 0;
    const items = snapshot.queue?.items ?? [];
    const currentIndex = snapshot.queue?.currentIndex ?? -1;
    const forwardVisits = currentIndex >= 0 && items[currentIndex]
      ? items.slice(currentIndex)
      : [];
    // Repeat-all is finite capture: include precisely the remaining current
    // lap, stopping immediately before the next automatic repeat.
    // Shuffle advancement chooses future items at action time. Capture only
    // reports the current determined visit rather than inventing a stable
    // sequence that the owner has not selected.
    const retainedOrder = Array.isArray(snapshot.queue.executionOrder)
      && snapshot.queue.executionOrder[0] === items[currentIndex]?.queueItemId
      && snapshot.queue.executionOrder.every((id) => items.some((item) => item.queueItemId === id))
      ? snapshot.queue.executionOrder
      : null;
    const executionVisits = retainedOrder ?? (snapshot.config?.shuffle
      ? (currentIndex >= 0 && items[currentIndex] ? [items[currentIndex].queueItemId] : [])
      : (snapshot.config?.repeat === 'all' && currentIndex > 0
        ? [...forwardVisits, ...items.slice(0, currentIndex)].map((item) => item.queueItemId)
        : forwardVisits.map((item) => item.queueItemId)));
    snapshot.queue.executionOrder = [...executionVisits];
    const identity = currentIdentity(snapshot);
    snapshot.meta = { ...snapshot.meta, playbackOwner: { ...identity } };
    return {
      snapshot,
      identity: { ...identity },
      capabilities: { handoffV1: false, seekable: controller.capabilities.seekable, liveEdge: false },
    };
  };

  // Durable position writes flow down into the hot tier (never the reverse).
  const setDurablePosition = (seconds, { playerDriven = false } = {}) => {
    store.dispatch({ type: 'UPDATE_POSITION', position: seconds, ...(playerDriven ? { __playerDriven: true } : {}) });
    position.set(seconds);
  };

  // `opOrigin`, when passed, explicitly stamps the LOAD_ITEM dispatch instead
  // of relying on ambient `pendingOrigin` — needed by callers whose own
  // mutation may land asynchronously (enqueue's container expansion), where
  // ambient `pendingOrigin` can no longer be trusted by the time this runs.
  const loadCurrent = (snapshot, opOrigin) => {
    const current = snapshot.queue.items[snapshot.queue.currentIndex];
    if (current) {
      store.dispatch({ type: 'LOAD_ITEM', item: itemFromQueueEntry(current), __opOrigin: opOrigin });
      position.set(0);
    }
  };

  const logQueueMutation = (op, next, context = {}) => {
    mediaLog.queueMutated({
      op,
      sessionId: snap().sessionId,
      ...context,
      queueLength: next.queue.items.length,
    });
  };

  // Move the current cursor to `entry` by IDENTITY (jump recomputes the
  // index), demoting the spent current's upNext priority on the way past.
  // `playerDriven` marks every dispatch as player-originated (auto-advance
  // after ended/error/stall) so none of them reads or clears a command's
  // staged `pendingOrigin` — see onTransition.
  const moveCurrentTo = (entry, { consumeExecutionOrder = false, preserveExecutionOrder = false, playerDriven = false } = {}, opOrigin) => {
    const tag = { __opOrigin: opOrigin, ...(playerDriven ? { __playerDriven: true } : {}) };
    const initial = snap();
    let working = initial;
    const oldCurrent = working.queue.items[working.queue.currentIndex];
    if (oldCurrent && oldCurrent.priority === 'upNext' && oldCurrent.queueItemId !== entry.queueItemId) {
      working = qOps.demote(working, oldCurrent.queueItemId);
    }
    if (preserveExecutionOrder) {
      if (working !== initial) store.replace(working, { type: 'REPLACE_SNAPSHOT', ...tag });
    } else {
      store.replace(consumeExecutionOrder
        ? qOps.consumeExecutionVisit(working, entry.queueItemId)
        : qOps.jump(working, entry.queueItemId), { type: 'REPLACE_SNAPSHOT', ...tag });
    }
    store.dispatch({ type: 'LOAD_ITEM', item: itemFromQueueEntry(entry), ...tag });
    position.set(0);
  };

  // Shared by the player (ended/error/stall → `{ playerDriven: true }`) and
  // by the skipNext command (→ its captured `opOrigin`). The distinction is
  // made explicit here, at the call site, rather than inferred from whatever
  // happens to be staged ambiently when the player fires.
  const advance = (reason, { playerDriven = false, opOrigin } = {}) => {
    const next = pickNextQueueItem(snap(), { reason });
    mediaLog.playbackAdvanced({
      sessionId: snap().sessionId,
      reason,
      nextContentId: next?.contentId ?? null,
    });
    if (!next) {
      store.dispatch({
        type: 'PLAYER_STATE',
        playerState: 'ended',
        __opOrigin: opOrigin,
        ...(playerDriven ? { __playerDriven: true } : {}),
      });
      return;
    }
    const repeatsCurrent = snap().config.repeat === 'one' && reason !== 'skip-next';
    moveCurrentTo(next, {
      consumeExecutionOrder: !repeatsCurrent,
      preserveExecutionOrder: repeatsCurrent,
      playerDriven,
    }, opOrigin);
  };

  const advanceBack = () => {
    const prevIdx = Math.max(-1, snap().queue.currentIndex - 1);
    if (prevIdx < 0) return;
    moveCurrentTo(snap().queue.items[prevIdx]);
  };

  const setConfig = (patch) => {
    beginAction();
    mediaLog.configChanged({ sessionId: snap().sessionId, patch });
    store.dispatch({ type: 'SET_CONFIG', patch });
  };

  const adopt = (incoming, { autoplay = true } = {}) => {
    const prepared = preparePlaybackOwnerAdoption(incoming);
    if (!prepared.valid) return { ok: false, code: 'INVALID_SNAPSHOT', errors: prepared.errors };
    const adopted = prepared.snapshot;
    const ownerId = snap().meta?.ownerId ?? clientId;
    const { playbackOwner: _sourceOwner, ...sourceMeta } = adopted.meta ?? {};
    adopted.meta = { ...sourceMeta, ownerId };
    adopted.state = adopted.queue.currentIndex >= 0 && adopted.currentItem
      ? 'loading'
      : (adopted.queue.items.length > 0 ? 'ready' : 'idle');
    store.dispatch({ type: 'ADOPT_SNAPSHOT', snapshot: adopted, autoplay });
    position.set(adopted.position);
    // The previous node may still be mounted for the same content/entry. Its
    // facts belong to the pre-adoption owner revision until PlayerBridge
    // admits the adopted render generation.
    nativePlayingObserved = false;
    nativeAdvancedObserved = false;
    nativeLastTime = Number.isFinite(nativeBinding?.node?.currentTime)
      ? nativeBinding.node.currentTime
      : null;
    // autoplay is an owner intent consumed by the existing Player render.
    // Calling the imperative handle here could start the retired native node
    // before Player has resolved the adopted current item.
    void autoplay;
    return { ok: true };
  };

  // ---- Queue enqueue paths -------------------------------------------------
  // Each applier takes a BATCH of queue inputs (a single item is a batch of
  // one) so container expansion and the plain single-item path share the
  // exact same store mutations.
  // `opOrigin` is threaded explicitly (not read from ambient `pendingOrigin`)
  // because the container-expansion path below can land these appliers well
  // after this operation's synchronous call returned — by then another
  // command may have staged, or cleared, the ambient value.
  const enqueueAppliers = {
    playNow: (inputs, opts, context, opOrigin) => {
      const next = qOps.playNowMany(snap(), inputs, opts);
      logQueueMutation('playNow', next, context);
      store.replace(next, { type: 'REPLACE_SNAPSHOT', __opOrigin: opOrigin });
      loadCurrent(next, opOrigin);
    },
    playNext: (inputs, _opts, context, opOrigin) => {
      const wasEmpty = snap().queue.items.length === 0;
      const next = qOps.playNextMany(snap(), inputs);
      logQueueMutation('playNext', next, context);
      store.replace(next, { type: 'REPLACE_SNAPSHOT', __opOrigin: opOrigin });
      // Play Next into an empty queue starts it (parity with add).
      if (wasEmpty && next.queue.items.length > 0) moveCurrentTo(next.queue.items[0], undefined, opOrigin);
    },
    addUpNext: (inputs, _opts, context, opOrigin) => {
      const next = qOps.addUpNextMany(snap(), inputs);
      logQueueMutation('addUpNext', next, context);
      store.replace(next, { type: 'REPLACE_SNAPSHOT', __opOrigin: opOrigin });
    },
    add: (inputs, _opts, context, opOrigin) => {
      const next = qOps.addMany(snap(), inputs);
      logQueueMutation('add', next, context);
      store.replace(next, { type: 'REPLACE_SNAPSHOT', __opOrigin: opOrigin });
      return qOps.addResultFromSnapshot(capture().snapshot);
    },
  };

  // Container inputs (album/show/playlist/… — marked by itemType/type/
  // childCount) expand ASYNCHRONOUSLY into their playable children before
  // enqueueing, so "Play album" queues the whole album instead of one track.
  // Non-container inputs take the applier synchronously — exact previous
  // behavior. Expansion failure or zero children degrades to the single-item
  // path: the tap always enqueues SOMETHING.
  //
  // `opOrigin` is captured HERE, synchronously, at the moment this specific
  // command begins — not re-read later — so a human command that runs while
  // this one's container expansion is still in flight can neither steal this
  // origin nor have its own overwritten by it (see commandHandler.js's
  // unconditional `setOrigin` per command for the other half of that fix).
  const enqueue = (op, input, opts) => {
    beginAction();
    const opOrigin = pendingOrigin;
    const apply = enqueueAppliers[op];
    const context = { contentId: input?.contentId };
    if (!isContainerInput(input)) {
      return apply([input], opts, context, opOrigin);
    }
    return expandContainerInput(input, { fetchImpl })
      .then((children) => {
        if (children && children.length > 0) {
          return apply(children, opts, {
            ...context,
            expandedFrom: input.contentId,
            expandedCount: children.length,
          }, opOrigin);
        }
        return apply([input], opts, context, opOrigin);
      })
      .catch(() => apply([input], opts, context, opOrigin));
  };

  const controller = {
    kind: 'local',
    id: clientId,
    store, // exposed for attachments + provider wiring; not part of the shape

    getSnapshot: () => store.getSnapshot(),
    subscribe: (fn) => store.subscribe(fn),
    // The origin is attached atomically to the next real state transition.
    // A rejected command therefore cannot change provenance on its own.
    setOrigin: (origin) => { pendingOrigin = origin ?? null; },
    clearOrigin: () => { pendingOrigin = null; },
    position: { get: position.get, subscribe: position.subscribe },

    // RELY.7a: whether a restored session is still held paused (no Player).
    restore: {
      isHeld: () => restoreHeld,
      subscribe: (fn) => { restoreListeners.add(fn); return () => restoreListeners.delete(fn); },
    },
    // RELY.5a: the current local playback problem, until playback recovers.
    problems: {
      get: () => problem,
      subscribe: (fn) => { problemListeners.add(fn); return () => problemListeners.delete(fn); },
      clear: () => clearProblem('dismissed'),
    },

    transport: {
      play: () => {
        beginAction();
        const opOrigin = pendingOrigin;
        mediaLog.transportCommand({ action: 'play', target: 'local' });
        // Only an explicit Play ends a restored session's paused hold.
        releaseRestore('play');
        // Playing from a stopped/ready session starts the queue head — this
        // branch dispatches LOAD_ITEM synchronously (via moveCurrentTo),
        // which already stamps `opOrigin` via the ambient mechanism above
        // (still unconsumed at this point). Otherwise, stamp explicitly:
        // "who last commanded this screen," synchronously, at command time
        // — not waiting for (or relying on) any later confirmation from the
        // player, which may never arrive, may arrive for an unrelated
        // reason, or may arrive after another command has already run.
        if (!snap().currentItem) {
          const first = snap().queue.items[0];
          if (!first) return;
          moveCurrentTo(first);
        } else {
          stampOrigin(opOrigin);
        }
        player.play();
      },
      pause: () => {
        beginAction();
        const opOrigin = pendingOrigin;
        mediaLog.transportCommand({ action: 'pause', target: 'local' });
        // Flush the hot-tier position durably — pausing is the moment the
        // user expects "their place" to be saved.
        const here = position.get().seconds;
        if (Number.isFinite(here) && here > 0) setDurablePosition(here);
        stampOrigin(opOrigin);
        player.pause();
      },
      stop: () => {
        beginAction();
        mediaLog.transportCommand({ action: 'stop', target: 'local' });
        player.pause();
        // Stop ends playback but does NOT destroy the queue — only the
        // explicit, confirmed reset does that (C2.3 / session state table:
        // stop → 'ready' while items remain, 'idle' when none).
        store.dispatch({ type: 'STOP' });
        position.set(0);
      },
      seekAbs: (seconds) => {
        beginAction();
        const opOrigin = pendingOrigin;
        mediaLog.transportCommand({ action: 'seekAbs', value: seconds, target: 'local' });
        if (restoreHeld) {
          // No Player is mounted yet: move the restored spot it will start at.
          const target = Math.max(0, Number(seconds) || 0);
          setDurablePosition(target);
          return;
        }
        // A seek dispatches nothing synchronously either — stamp
        // provenance directly, same as play/pause above.
        stampOrigin(opOrigin);
        player.seek(seconds);
      },
      seekRel: (delta) => {
        beginAction();
        mediaLog.transportCommand({ action: 'seekRel', value: delta, target: 'local' });
        const mediaTime = player.getMediaElement?.()?.currentTime;
        const current = typeof mediaTime === 'number' && Number.isFinite(mediaTime)
          ? mediaTime
          : (position.get().seconds ?? snap().position ?? 0);
        controller.transport.seekAbs(Math.max(0, current + delta));
      },
      skipNext: () => {
        beginAction();
        const opOrigin = pendingOrigin;
        mediaLog.transportCommand({ action: 'skipNext', target: 'local' });
        // A person moving on (e.g. Skip now on a waiting file) ends any hold.
        clearSourceWaitTimer();
        holdContentId = null;
        advance('skip-next', { opOrigin });
        clearProblem('skipped-by-person');
      },
      skipPrev: () => {
        beginAction();
        mediaLog.transportCommand({ action: 'skipPrev', target: 'local' });
        advanceBack();
      },
      restartCurrent: () => {
        beginAction();
        mediaLog.transportCommand({ action: 'restartCurrent', target: 'local' });
        controller.transport.seekAbs(0);
      },
    },

    queue: {
      playNow: (input, opts) => enqueue('playNow', input, opts),
      playNext: (input) => enqueue('playNext', input),
      addUpNext: (input) => enqueue('addUpNext', input),
      add: (input) => enqueue('add', input),
      remove: (queueItemId) => {
        beginAction();
        const wasCurrent = snap().queue.items[snap().queue.currentIndex]?.queueItemId === queueItemId;
        const next = qOps.remove(snap(), queueItemId);
        logQueueMutation('remove', next, { queueItemId });
        store.replace(next);
        if (wasCurrent) {
          // Removing the playing item: its successor takes over cleanly, or
          // playback stops when nothing is left.
          const successor = next.queue.items[next.queue.currentIndex];
          if (successor) moveCurrentTo(successor, { preserveExecutionOrder: true });
          else { player.pause(); store.dispatch({ type: 'STOP' }); position.set(0); }
        }
      },
      reorder: (input) => {
        beginAction();
        const next = qOps.reorder(snap(), input);
        logQueueMutation('reorder', next);
        store.replace(next);
      },
      jump: (queueItemId) => {
        beginAction();
        const next = qOps.jump(snap(), queueItemId);
        logQueueMutation('jump', next, { queueItemId });
        store.replace(next);
        loadCurrent(next);
      },
      clear: () => {
        beginAction();
        const next = qOps.clear(snap());
        logQueueMutation('clear', next);
        store.replace(next);
      },
    },

    config: {
      setShuffle: (enabled) => setConfig({ shuffle: !!enabled }),
      setRepeat: (mode) => {
        if (!['off', 'one', 'all'].includes(mode)) return;
        setConfig({ repeat: mode });
      },
      setShader: (shader) => setConfig({ shader: shader ?? null }),
      setVolume: (level) => {
        const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
        setConfig({ volume: clamped });
      },
      setPlaybackRate: (rate) => {
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return;
        setConfig({ playbackRate: rate });
      },
    },

    lifecycle: {
      // RELY.8a: Start fresh, itemised. `keep` names the parts to keep
      // ({ playing, queue, spot }); everything else is cleared. Clearing
      // everything starts a brand-new session (and forgets the persisted
      // one). A spot is only kept together with what's playing.
      reset: ({ keep = {} } = {}) => {
        beginAction();
        const before = snap();
        const current = before.queue.items[before.queue.currentIndex] ?? null;
        const keepPlaying = !!keep.playing && !!before.currentItem;
        const keepQueue = !!keep.queue;
        const keepSpot = keepPlaying && !!keep.spot;
        const kept = [keepPlaying && 'playing', keepQueue && 'queue', keepSpot && 'spot'].filter(Boolean);
        const cleared = ['playing', 'queue', 'spot'].filter((part) => !kept.includes(part));
        mediaLog.sessionStartFresh({ sessionId: before.sessionId, kept, cleared });
        clearProblem('start-fresh');
        if (!keepPlaying && !keepQueue) {
          mediaLog.sessionReset({ sessionId: before.sessionId });
          player.pause();
          clearPersisted();
          store.dispatch({ type: 'RESET', newSessionId: randomUuid() });
          position.set(0);
          return;
        }
        if (!keepPlaying) {
          player.pause();
          if (current) store.replace(qOps.remove(before, current.queueItemId));
          store.dispatch({ type: 'STOP' });
          position.set(0);
          return;
        }
        if (!keepQueue) {
          const items = current ? [current] : [];
          store.replace({
            ...before,
            queue: {
              ...before.queue,
              items,
              currentIndex: current ? 0 : -1,
              upNextCount: items.filter((item) => item.priority === 'upNext').length,
            },
          });
        }
        if (!keepSpot) {
          setDurablePosition(0);
          if (!restoreHeld) player.seek(0);
        }
      },
      adoptSnapshot: (snapshot, { autoplay = true } = {}) => {
        beginAction();
        return adopt(snapshot, { autoplay });
      },
    },

    portability: {
      // Position comes from the hot tier — the durable tier can lag by up to
      // 5s, which would blow the C7.3 hand-off tolerance.
      snapshotForHandoff: () => capture().snapshot,
      capture,
      adopt,
      getNativeObservation,
      subscribeNative: (listener) => {
        if (typeof listener !== 'function') return () => {};
        nativeListeners.add(listener);
        return () => nativeListeners.delete(listener);
      },
      stopIfCurrent: (expected) => {
        const current = capture().identity;
        if (!samePlaybackOwnerIdentity(expected, current)) {
          return { ok: false, code: 'SOURCE_CHANGED' };
        }
        controller.transport.stop();
        return { ok: true };
      },
      receiveClaim: (snapshot) => controller.lifecycle.adoptSnapshot(snapshot, { autoplay: true }),
    },

    get capabilities() {
      const item = snap().currentItem;
      if (!item) return { seekable: false, live: false, reason: 'Nothing is playing', acked: false, speed: { available: true, reason: null } };
      if (item.isLive === true) {
        return {
          seekable: false, live: true,
          reason: 'Live playback has no seekable position', acked: false, speed: { available: true, reason: null },
        };
      }
      if (!Number.isFinite(item.duration) || item.duration <= 0) {
        return {
          seekable: false, live: false,
          reason: 'Playback duration is unavailable', acked: false, speed: { available: true, reason: null },
        };
      }
      return {
        seekable: true, live: false, reason: null, acked: false, speed: { available: true, reason: null },
      };
    },

    // ---- PlayerBridge surface (not part of the controller shape) ----
    setPlayerHandle(handle) {
      player = {
        play: () => {}, pause: () => {}, seek: () => {}, setPlaybackRate: () => {}, setShader: () => {},
        getMediaElement: () => null,
        getMountedContentId: () => null,
        getMountedMediaGeneration: () => null, ...handle,
      };
    },
    getMediaElement: () => player.getMediaElement?.() ?? null,
    bindNativeObservation,
    releaseNativeObservation: (node, resolvedGeneration) => {
      if (!nativeBinding || nativeBinding.node !== node || nativeBinding.resolvedGeneration !== resolvedGeneration) return;
      bindNativeObservation(null, null, resolvedGeneration);
    },
    onNativeObservationEvent,
    onPlayerObservation: (contentId, observation = {}) => {
      if (snap().currentItem?.contentId !== contentId) return;
      const playerState = observation.stalled === true && observation.paused === false
        ? 'buffering'
        : (observation.paused === true
          ? 'paused'
          // A decoder can be unpaused while buffering or not yet rendered.
          // Only the actual native `playing` event may establish playing.
          : (observation.playing === true ? 'playing' : undefined));
      // Player-driven dispatches never touch meta.origin — provenance is
      // "who last commanded this screen," and stays sticky (unchanged) until
      // the next actual command, whether that lands sooner or later than
      // this observation.
      store.dispatch({
        type: 'PLAYER_OBSERVATION',
        contentId,
        itemPatch: observedItemPatch(observation),
        playerState,
        __playerDriven: true,
      });
    },
    onPlayerStateChange: (state, contentId = null) => {
      if (contentId != null && snap().currentItem?.contentId !== contentId) return;
      store.dispatch({ type: 'PLAYER_STATE', playerState: state, __playerDriven: true });
      // Playback is moving again: the handle's problem sign clears.
      if (state === 'playing') clearProblem('playing');
    },
    onPlayerEnded: (contentId = null) => {
      if (contentId != null && snap().currentItem?.contentId !== contentId) return;
      // Holding on a refused file during a library outage: its clear is not an end.
      if (holdContentId && snap().currentItem?.contentId === holdContentId) return;
      advance('item-ended', { playerDriven: true });
    },
    onPlayerError: ({ message, code } = {}) => {
      if (code === 'source-unavailable-gave-up') {
        clearSourceWaitTimer();
        const failedItem = snap().currentItem;
        if (!failedItem) return;
        if (holdContentId && failedItem.contentId === holdContentId) {
          // Storm hold: stay on the item; the library-unavailable problem stands.
          mediaLog.playbackError({ sessionId: snap().sessionId, contentId: failedItem.contentId, error: 'source unavailable (held)', code });
          return;
        }
        mediaLog.playbackError({ sessionId: snap().sessionId, contentId: failedItem.contentId, error: message ?? 'source unavailable', code });
        store.dispatch({ type: 'ITEM_ERROR', error: message ?? 'source unavailable', code, __playerDriven: true });
        advance('source-unavailable', { playerDriven: true });
        lastSourceSkipAt = Date.now();
        raiseProblem(failedItem, 'file-unavailable');
        return;
      }
      mediaLog.playbackError({
        sessionId: snap().sessionId,
        contentId: snap().currentItem?.contentId,
        error: message ?? 'unknown',
        code: code ?? null,
      });
      const failed = snap().currentItem;
      store.dispatch({ type: 'ITEM_ERROR', error: message ?? 'unknown', code: code ?? null, __playerDriven: true });
      advance('item-error', { playerDriven: true });
      if (failed) raiseProblem(failed, 'error');
    },
    onPlayerSourceWait: ({ waiting, contentId = null, decision = null } = {}) => {
      const current = snap().currentItem;
      if (!current) return;
      if (contentId != null && current.contentId !== contentId) return;
      if (waiting) {
        clearSourceWaitTimer();
        if (lastSourceSkipAt != null && Date.now() - lastSourceSkipAt < SOURCE_STORM_WINDOW_MS) {
          holdContentId = current.contentId;
          raiseHeldProblem('library-unavailable', current);
          return;
        }
        const waitingFor = current.contentId;
        sourceWaitTimer = setTimeout(() => {
          sourceWaitTimer = null;
          const now = snap().currentItem;
          if (now?.contentId !== waitingFor) return;
          raiseHeldProblem('waiting', now);
        }, SOURCE_WAIT_NOTICE_MS);
        return;
      }
      clearSourceWaitTimer();
      if (decision === 'gave-up') return; // onPlayerError reports it
      if (problem && ['waiting', 'library-unavailable'].includes(problem.kind) && problem.item?.contentId === current.contentId) {
        holdContentId = null;
        clearProblem('source-restored');
      }
    },
    onPlayerStalled: ({ stalledMs } = {}) => {
      const current = snap().currentItem;
      if (!current) return;
      mediaLog.playbackStallAutoAdvanced({
        sessionId: snap().sessionId,
        contentId: current.contentId,
        stalledMs: Number.isFinite(stalledMs) ? stalledMs : null,
      });
      store.dispatch({ type: 'PLAYER_STATE', playerState: 'stalled', __playerDriven: true });
      advance('stall-auto-advance', { playerDriven: true });
      raiseProblem(current, 'stalled');
    },
    /** Durable (≥5s cadence) position write. */
    onPlayerProgress: (seconds, contentId = null) => {
      if (contentId != null && snap().currentItem?.contentId !== contentId) return;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) setDurablePosition(seconds, { playerDriven: true });
    },
    /** Hot-tier tick — feeds ONLY the position channel; snapshot subscribers
     *  do not re-render. */
    onPlayerPositionTick: (seconds, contentId = null) => {
      if (contentId != null && snap().currentItem?.contentId !== contentId) return;
      position.set(seconds);
    },
  };

  Object.assign(controller, createItemActionOwner({
    targetId: clientId,
    capture: () => {
      // Portability exposes only determined shuffle visits. Mutating or
      // undoing this live owner must retain its complete advancement state,
      // while still capturing the actual native clock before replacement.
      const nativePosition = capture().snapshot.position;
      return { ...structuredClone(snap()), position: nativePosition };
    },
    // Uses `itemActionGuardRevision` (from `itemActionFingerprint`), not the
    // shared `queueRevision` — see that fingerprint's comment above. The
    // ledger only ever compares this object opaquely (JSON.stringify), so
    // the field is still named `queueRevision` here purely to keep that
    // comparison shape stable; it does not feed cross-controller identity.
    revision: () => ({ ownerInstanceId, queueRevision: itemActionGuardRevision, stopRevision }),
    fetchImpl,
    // `operationId` (already threaded by itemActionOwner.js — the forward
    // path passes it directly; the undo/restore path passes it via
    // `record.operationId`) looks up this specific operation's captured
    // origin (see the execute/undo wrappers below) rather than trusting
    // ambient `pendingOrigin`, which item-action fetches can outlive.
    apply: (snapshot, { playbackChanged, restore, operationId } = {}) => {
      const opOrigin = operationId != null ? operationOrigins.get(operationId) : undefined;
      if (operationId != null) operationOrigins.delete(operationId);
      if (restore) {
        // This is this owner's detached capture, including unresolved format
        // metadata; the stricter network-handoff validator is not applicable.
        const autoplay = snapshot.state !== 'paused';
        store.dispatch({ type: 'ADOPT_SNAPSHOT', snapshot, autoplay, __opOrigin: opOrigin });
        position.set(snapshot.position);
        return { ok: true };
      }
      store.replace(snapshot, { type: 'REPLACE_SNAPSHOT', __opOrigin: opOrigin });
      if (playbackChanged) {
        if (snapshot.queue.currentIndex >= 0) loadCurrent(snapshot, opOrigin);
        else { player.pause(); store.dispatch({ type: 'STOP', __opOrigin: opOrigin }); position.set(0); }
      }
      return { ok: true };
    },
  }));
  // Capture this specific execute()/undo() invocation's origin, keyed by
  // operationId, at the moment it is CALLED — synchronously, before any
  // async work (container expansion, the fetch behind a container item-action)
  // has a chance to let an unrelated command change or clear ambient
  // `pendingOrigin` first. `apply` above looks the value back up by the same
  // key whenever this operation's mutation actually lands.
  const rawExecute = controller.execute;
  const rawUndo = controller.undo;
  controller.execute = (command) => {
    if (command?.operationId != null) operationOrigins.set(command.operationId, pendingOrigin ?? defaultOrigin());
    return rawExecute(command);
  };
  controller.undo = (operationId) => {
    if (operationId != null) operationOrigins.set(operationId, pendingOrigin ?? defaultOrigin());
    return rawUndo(operationId);
  };
  return controller;
}

export default createLocalSessionController;
