// frontend/src/modules/Media/search/useContentDispatch.js
// Routes a selected content id to the right playback surface. Task 14 (spec
// D6) fixed the tap grammar to ONE rule used everywhere: a playable leaf
// tap plays now; a CONTAINER tap ALWAYS browses. The old precedence let a
// container tap CAST when a device was aimed (dock chip) — that's exactly
// the "accidental queue blowaway" this remediation exists to stop: picking
// "Van Halen" in a search box with a speaker aimed used to fan the whole
// discography out to that speaker on a single tap, with no undo. Sending a
// container anywhere is now an EXPLICIT verb — the ▶ action
// (playContainerAsQueue), wired from the row's trailing button — never an
// implicit side effect of tapping the row.
//
// `dispatch(id, item)` — tap/select precedence:
//   1. CONTAINER (any item.isContainer/itemType/type) → push the full browse
//      view (contentIdToBrowsePath). This is checked FIRST, above peek and
//      the cast chip, so it wins regardless of what's aimed. Browsing is a
//      pure navigation — it never touches any device's playback — so this
//      is also safe for the peek (remote-control) case: opening a show's
//      episode list on the canvas doesn't stop whatever the peeked device
//      is doing.
//   2. a cast target aimed via the dock's chip, leaf → cast there in the
//      chip's mode.
//   3. otherwise, leaf → play locally, replacing the queue.
// Returns which branch it took so callers can log the destination.
//
// `playContainerAsQueue(id, item, { shuffle })` — the ▶ verb, container rows
// only. Same destination precedence as above minus the browse branch
// (there's no "browse" reading of an explicit send-it-there action): the
// displayed aim wins, remote or local. The local branch reuses
// resultToQueueInput so the container's itemType/type/childCount markers
// survive into queue.playNow — the session layer expands them into playable
// children ASYNCHRONOUSLY (containerExpansion.js); no separate
// container-queueing logic needed here.
//
// `{ shuffle: true }` is the 🔀 verb (Task 15, browse header) riding the
// SAME function: local turns on session shuffle (config.setShuffle) before
// enqueueing — advancement.js only consults shuffle on the NEXT pick, not
// the item already loaded by playNow, so the tapped container starts on its
// natural first item and shuffles from there on, matching the transport
// bar's own shuffle toggle. Cast targets thread `shuffle:true` straight through
// dispatchToTarget -> buildDispatchUrl's `?shuffle=1`, the same deep-link
// param useUrlCommand.js already applies via config.setShuffle on the
// RECEIVING device — no separate remote-shuffle protocol invented here.
//
// `addContainerToQueue(id, item)` — the + verb (Task 15): same destination
// precedence again, but appends rather than replacing. Local calls
// queue.add (not playNow); cast targets send the container as `queue:` instead
// of `play:` on the dispatch payload — useUrlCommand.js's `cmd.queue` branch
// on the receiving device already resolves that to controller.queue.add.
//
// Every branch reports its outcome through the one outcome system
// (DispatchProvider, RELY.1a / PR-6): a cast is an attempt record that the
// tray names with the screen and its progress, then confirms or fails with
// its own Retry; a local action is a quiet record naming the item "here",
// carrying its Undo. No branch raises a second, ad-hoc toast.
import React, { useCallback, useContext, useMemo } from 'react';
import { useNav } from '../shell/NavProvider.jsx';
import { useDispatch } from '../cast/useDispatch.js';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useSessionController } from '../controller/useSessionController.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { contentIdToBrowsePath } from '../browse/browsePath.js';
import { resultToQueueInput } from './resultToQueueInput.js';
import { PeekContext } from '../peek/PeekContext.js';
import { executeItemAction, createOperationId } from '../actions/itemAction.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { isShowItem } from './showOn.js';
import mediaLog from '../logging/mediaLog.js';

// Screens that apply an item action's start position: Media sessions (named
// browsers, and screens commanded over the websocket). Others load by URL and
// ignore `seconds`, so a play there must not claim where it continues.
function honoursStartPosition(targetId, devices) {
  if (typeof targetId !== 'string') return false;
  if (targetId.startsWith('browser:')) return true;
  const device = (devices ?? []).find(d => d?.id === targetId);
  return device?.content_control?.type === 'websocket';
}

const LOCAL_KIND = { playNow: 'play', shuffle: 'shuffle', add: 'add', playNext: 'playNext', playFirst: 'playFirst' };

export function useContentDispatch() {
  const { push } = useNav();
  const { dispatchToTarget, recordLocal, resolveLocal } = useDispatch();
  const { targetIds, mode } = useCastTarget();
  const { controller, queue, config } = useSessionController('local');
  const peek = useContext(PeekContext);
  const fleetDevices = useContext(FleetContext)?.devices ?? null;

  // A local action's outcome: one quiet record naming the item "here".
  const confirmLocal = useCallback((kind, input) => recordLocal?.({
    kind: LOCAL_KIND[kind] ?? kind,
    phase: 'confirmed',
    item: { contentId: input?.contentId ?? null, title: input?.title ?? null },
    command: { kind, item: input },
  }), [recordLocal]);

  // Shared by dispatch()'s cast branch and playContainerAsQueue()'s /
  // addContainerToQueue()'s cast branches. `verb: 'queue'` (Task 15's +
  // button) sends the container as an append rather than a replace. The
  // attempt's own outcome record (DispatchProvider) names the screen and its
  // progress, so nothing else is shown here.
  const castTo = useCallback((castTargetIds, castMode, id, title, opts = {}) => {
    const { shuffle = false, verb = 'play', itemAction, startOver = false, resumedFrom = null } = opts;
    // An aimed content pick starts new playback; it is not an ownership
    // transfer. Keep the transfer guard reserved for snapshot handoff while
    // allowing a fresh/default destination aim to dispatch normally.
    const mode = castMode === 'transfer' ? 'fork' : castMode;
    const targetPayload = verb === 'queue' ? { queue: id } : { play: id };
    return dispatchToTarget({
      targetIds: castTargetIds,
      ...targetPayload,
      mode,
      title,
      ...(shuffle ? { shuffle: true } : {}),
      ...(itemAction ? { itemAction } : {}),
      ...(startOver ? { startOver: true, resumedFrom } : {}),
    });
  }, [dispatchToTarget]);

  const runAction = useCallback((kind, id, item, opts = {}) => {
    let input = resultToQueueInput({ ...item, id }) ?? { contentId: id, title: item?.title };
    // PLAY.4a: `startAt` is an explicit start the person chose (a screen's
    // spot, or 0 for the beginning) and rides the item; `resumedFrom` says the
    // play continues from a saved spot, so its confirmation offers Start over.
    if (kind === 'playNow' && Number.isFinite(opts.startAt)) input = { ...input, seconds: opts.startAt, resume: false };
    const resumedFrom = kind !== 'playNow' ? null
      : Number.isFinite(opts.startAt) ? (opts.startAt > 0 ? opts.startAt : null)
        : (Number.isFinite(opts.resumedFrom) && opts.resumedFrom > 0 ? opts.resumedFrom : null);
    const honoured = targetIds.length === 0 || targetIds.every(id => honoursStartPosition(id, fleetDevices));
    const resume = resumedFrom != null && honoured ? { startOver: true, resumedFrom } : {};
    const operationId = createOperationId();
    // `opts.targetIds`: a one-off destination for this action only (Add to
    // this queue, STEER.1b/AC7) — the aim itself is never read or changed.
    const actionTargets = Array.isArray(opts.targetIds) ? opts.targetIds : targetIds;
    const remote = actionTargets.length > 0;
    const destination = remote ? {
      id: actionTargets.join(','),
      execute: command => {
        castTo(actionTargets, opts.targetIds ? 'fork' : mode, id, item?.title, {
          verb: ['add', 'playNext', 'playFirst'].includes(kind) ? 'queue' : 'play',
          shuffle: kind === 'shuffle', itemAction: command, ...resume,
        });
        return { ok: true, pending: true, operationId: command.operationId };
      },
      undo: async operation => {
        const results = await Promise.all(actionTargets.map(target => peek?.getController?.(target)?.undo(operation)
          ?? { ok: false, code: 'ITEM_ACTION_UNSUPPORTED' }));
        return results.find(result => !result?.ok) ?? { ok: true };
      },
    } : controller;
    // Older embedders expose just the queue facade. Keep their additive API
    // working while full Media owners always use the common operation seam.
    if (!destination) {
      if (kind === 'playNow' || kind === 'shuffle') {
        if (kind === 'shuffle') config?.setShuffle?.(true);
        queue.playNow(input, { clearRest: !!opts.collection || kind === 'shuffle' });
      } else if (kind === 'playNext') queue.addUpNext?.(input);
      else if (kind === 'playFirst') queue.playNext?.(input);
      else queue.add(input);
      confirmLocal(kind, input);
      return 'local';
    }
    let attemptId = null;
    executeItemAction({ kind, item: input, destination, operationId, options: {
      onStarted: () => {
        if (remote) return;
        // Undo is offered at tap time, on the outcome itself (RELY.4a).
        attemptId = recordLocal?.({
          kind: LOCAL_KIND[kind] ?? kind,
          phase: 'running',
          item: { contentId: input.contentId, title: input.title ?? item?.title ?? null },
          command: { kind, item: input },
          undo: { operationId, expiresAt: Date.now() + 10000, run: destination.undo },
          ...resume,
        }) ?? null;
      },
    } }).then(result => {
      if (remote) return;
      if (result?.ok === false) {
        resolveLocal?.(attemptId, { phase: 'failed', reason: result.reason ?? result.code ?? 'Could not apply action' });
      } else {
        resolveLocal?.(attemptId, { phase: 'confirmed', ordinal: Number.isInteger(result?.ordinal) ? result.ordinal : null, count: Number.isInteger(result?.count) ? result.count : null });
      }
    }).catch(error => {
      if (!remote) resolveLocal?.(attemptId, { phase: 'failed', reason: error?.message ?? 'Could not apply action' });
    });
    return remote ? 'cast' : 'local';
  }, [targetIds, mode, castTo, controller, queue, config, peek, recordLocal, resolveLocal, confirmLocal, fleetDevices]);

  // `opts.replaceHistoryEntry` is for a caller that is itself occupying the
  // current history entry and is about to close: the mobile Search Mode. Its
  // browse push must REPLACE that entry rather than stack on top of it —
  // otherwise the surface's exit path traverses back over the marker and
  // un-does the navigation the tap just made (a container tap landed the user
  // back on Home). Only threaded through when true so every other caller's
  // push call is byte-identical to before.
  const dispatch = useCallback((id, item, opts = {}) => {
    const title = item?.title ?? null;
    // Containers ALWAYS browse — see header comment. Checked first so it
    // wins over both the peek view and an aimed cast target. The opened
    // browse view carries the tapped item along as `containerItem` (Task
    // 15) so BrowseView can render its own ▶/🔀/+ header without a second
    // fetch — the List API item BrowseView already has for nested drills
    // gets the same treatment below in BrowseView.jsx itself.
    if (item && isContainer(item)) {
      const browseParams = {
        path: contentIdToBrowsePath(id),
        label: title ?? id,
        containerItem: { ...item, id: item.id ?? id },
      };
      if (opts.replaceHistoryEntry) push('browse', browseParams, { replaceEntry: true });
      else push('browse', browseParams);
      return 'browse';
    }
    // FIND.8b/AC3: a camera or single photo shows on the device in hand,
    // whatever is aimed; "Show on…" is how it goes to another screen.
    if (item && isShowItem(item)) {
      mediaLog.shownHere({ contentId: id, aimed: targetIds.length });
      if (controller) return runAction('playNow', id, item, { targetIds: [] });
      const input = resultToQueueInput({ ...item, id }) ?? { contentId: id, title, thumbnail: item?.thumbnail ?? null };
      queue.playNow(input, { clearRest: true });
      confirmLocal('playNow', input);
      return 'local';
    }
    if (controller) return runAction('playNow', id, item);
    if (targetIds.length > 0) {
      castTo(targetIds, mode, id, title);
      return 'cast';
    }
    const input = { contentId: id, title, thumbnail: item?.thumbnail ?? null };
    queue.playNow(input, { clearRest: true });
    confirmLocal('playNow', input);
    return 'local';
  }, [push, targetIds, mode, queue, castTo, controller, runAction, confirmLocal]);

  // Explicit leaf actions from the ResultRow ⋯ menu share the aimed-target
  // route without inheriting selection's clearRest policy: More → Play Now
  // starts this item while retaining the local queue tail. Only these two
  // verbs are centralized here; Play Next/Up Next remain local queue edits.
  const dispatchLeafVerb = useCallback((verb, id, item, opts = {}) => {
    const kind = ({ upNext: 'playFirst', playOn: 'playNow', addOn: 'add' })[verb] ?? verb;
    if (!['playNow', 'add', 'playNext', 'playFirst', 'shuffle'].includes(kind)) return undefined;
    if (controller || !['playNow', 'add'].includes(kind)) return runAction(kind, id, item, opts);
    const title = item?.title ?? null;
    if (targetIds.length > 0) {
      castTo(targetIds, mode, id, title, { verb: verb === 'add' ? 'queue' : 'play' });
      return 'cast';
    }
    const input = (item && resultToQueueInput({ ...item, id: item.id ?? id }))
      ?? { contentId: id, title, thumbnail: item?.thumbnail ?? null };
    if (verb === 'playNow') queue.playNow(input);
    else queue.add(input);
    confirmLocal(verb === 'playNow' ? 'playNow' : 'add', input);
    return 'local';
  }, [targetIds, mode, queue, castTo, controller, runAction, confirmLocal]);

  // The ▶ verb on a container row: explicitly send the WHOLE container to
  // the current destination, replacing the queue. Same destination
  // precedence as leaves (the displayed aim, then local) — there's just no
  // browse reading of an explicit "send it"
  // action, so that branch is absent here. `opts.shuffle` (Task 15's 🔀
  // verb, see header comment) rides the same two branches; when it's
  // false/omitted every payload is byte-identical to the pre-Task-15 shape.
  const playContainerAsQueue = useCallback((id, item, opts = {}) => {
    const { shuffle = false } = opts;
    if (controller) return runAction(shuffle ? 'shuffle' : 'playNow', id, { ...item, itemType: 'container' }, { collection: true });
    const title = item?.title ?? null;
    if (targetIds.length > 0) {
      castTo(targetIds, mode, id, title, { shuffle });
      return 'cast';
    }
    const input = (item && resultToQueueInput({ ...item, id: item.id ?? id }))
      ?? { contentId: id, title, thumbnail: item?.thumbnail ?? null };
    // Set BEFORE enqueueing: advancement.js only reads config.shuffle when
    // picking the NEXT item, so this can't reorder what's about to load —
    // it just guarantees no listener ever observes a full queue with
    // shuffle still off after the 🔀 verb fired.
    if (shuffle) config?.setShuffle?.(true);
    queue.playNow(input, { clearRest: true });
    confirmLocal(shuffle ? 'shuffle' : 'playNow', input);
    return 'local';
  }, [targetIds, mode, queue, config, castTo, controller, runAction, confirmLocal]);

  // The + verb on a container row (Task 15): append the WHOLE container to
  // the current destination's queue instead of replacing it. Same
  // destination precedence as ▶, but local calls queue.add and cast targets
  // send the container as `queue:` (append) rather than `play:` (replace) —
  // see castTo's verb option and the header comment above.
  const addContainerToQueue = useCallback((id, item) => {
    if (controller) return runAction('add', id, { ...item, itemType: 'container' });
    const title = item?.title ?? null;
    if (targetIds.length > 0) {
      castTo(targetIds, mode, id, title, { verb: 'queue' });
      return 'cast';
    }
    const input = (item && resultToQueueInput({ ...item, id: item.id ?? id }))
      ?? { contentId: id, title, thumbnail: item?.thumbnail ?? null };
    queue.add(input);
    confirmLocal('add', input);
    return 'local';
  }, [targetIds, mode, queue, castTo, controller, runAction, confirmLocal]);

  // Add to this queue (STEER.1b/AC7, RQ-STEER-22): one addition to one
  // screen's queue — a leaf or a whole container — without touching the aim.
  const addToScreen = useCallback((deviceId, id, item) => {
    if (typeof deviceId !== 'string' || !deviceId || !id) return null;
    const asItem = item && isContainer(item) ? { ...item, itemType: 'container' } : item;
    runAction('add', id, asItem, { targetIds: [deviceId] });
    return 'add-to-screen';
  }, [runAction]);

  return useMemo(
    () => ({ dispatch, dispatchLeafVerb, playContainerAsQueue, addContainerToQueue, addToScreen }),
    [dispatch, dispatchLeafVerb, playContainerAsQueue, addContainerToQueue, addToScreen]
  );
}

export default useContentDispatch;
