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
//   2. `peek` (remote-control) view with a leaf → cast to the peeked device,
//      mode:'fork' (a remote control must never STOP the device it is
//      driving — fork starts a fresh play without touching what's already
//      running elsewhere).
//   3. a cast target aimed via the dock's chip, leaf → cast there in the
//      chip's mode.
//   4. otherwise, leaf → play locally, replacing the queue.
// Returns which branch it took so callers can log the destination.
//
// `playContainerAsQueue(id, item, { shuffle })` — the ▶ verb, container rows
// only. Same destination precedence as above minus the browse branch
// (there's no "browse" reading of an explicit send-it-there action): peek
// wins (fork, so the remote control still never stops its own device), then
// an aimed cast target, then local. The local branch reuses
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
// bar's own shuffle toggle. Cast/peek thread `shuffle:true` straight through
// dispatchToTarget -> buildDispatchUrl's `?shuffle=1`, the same deep-link
// param useUrlCommand.js already applies via config.setShuffle on the
// RECEIVING device — no separate remote-shuffle protocol invented here.
//
// `addContainerToQueue(id, item)` — the + verb (Task 15): same destination
// precedence again, but appends rather than replacing. Local calls
// queue.add (not playNow); cast/peek send the container as `queue:` instead
// of `play:` on the dispatch payload — useUrlCommand.js's `cmd.queue` branch
// on the receiving device already resolves that to controller.queue.add.
//
// The cast branches are exactly the moment the pre-fix incident was about:
// a tap on a search result went to hidden dock-chip state with no
// acknowledgement at all — success or failure. Two toasts close that gap:
// a synchronous "Casting <title> to <device>" the instant a cast routes
// (naming the destination the way DestinationLine/CastTargetChip already
// show it), and — once the fleet dispatch actually resolves — a failure
// toast naming the device and the SPECIFIC backend error (never a
// substituted generic string), with Retry re-invoking the exact same
// dispatch via DispatchProvider's retryLast.
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useNav } from '../shell/NavProvider.jsx';
import { useDispatch } from '../cast/useDispatch.js';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useSessionController } from '../controller/useSessionController.js';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { contentIdToBrowsePath } from '../browse/browsePath.js';
import { resultToQueueInput } from './resultToQueueInput.js';

function namesFor(ids, devices) {
  return ids.map((id) => deviceName(devices.find((d) => d.id === id), id)).join(', ');
}

function notifyCastFailure({ name, error, onRetry }) {
  notifications.show({
    id: `content-dispatch-failed-${name}`,
    color: 'red',
    autoClose: false,
    withCloseButton: true,
    title: `Couldn't cast to ${name}`,
    message: React.createElement(
      Group,
      { justify: 'space-between', gap: 'sm', wrap: 'nowrap' },
      React.createElement(Text, { size: 'sm' }, error || 'Unknown error'),
      React.createElement(
        Button,
        { size: 'xs', variant: 'subtle', 'data-testid': 'content-dispatch-retry', onClick: onRetry },
        'Retry'
      )
    ),
  });
}

export function useContentDispatch() {
  const { view, params, push } = useNav();
  const { dispatchToTarget, dispatches, retryLast } = useDispatch();
  const { targetIds, mode } = useCastTarget();
  const { queue, config } = useSessionController('local');
  const { devices } = useFleetContext();
  // dispatchId -> deviceId, for dispatches THIS hook fired that haven't
  // resolved yet. dispatchToTarget is fire-and-forget (it returns the
  // dispatchIds before the HTTP call settles), so the only way to know a
  // cast actually failed is to watch DispatchProvider's live `dispatches`
  // map for the same dispatchId to flip to 'failed'.
  const pendingRef = useRef(new Map());

  useEffect(() => {
    if (!dispatches || pendingRef.current.size === 0) return;
    for (const [dispatchId, deviceId] of [...pendingRef.current]) {
      const entry = dispatches.get(dispatchId);
      if (!entry || entry.status === 'running') continue;
      pendingRef.current.delete(dispatchId);
      if (entry.status === 'failed') {
        const name = deviceName(devices.find((d) => d.id === deviceId), deviceId);
        notifyCastFailure({ name, error: entry.error, onRetry: retryLast });
      }
    }
  }, [dispatches, devices, retryLast]);

  // Shared by both dispatch()'s cast branch and playContainerAsQueue()'s /
  // addContainerToQueue()'s cast branches: fire the confirmation toast,
  // dispatch, and register the resulting dispatchIds so the failure watcher
  // above can name them. `verb: 'queue'` (Task 15's + button) sends the
  // container as an append rather than a replace, and says so in the toast
  // ("Adding" not "Casting") so the wording never claims an action it
  // didn't take.
  const castTo = useCallback((castTargetIds, castMode, id, title, opts = {}) => {
    const { shuffle = false, verb = 'play' } = opts;
    const name = namesFor(castTargetIds, devices);
    const label = verb === 'queue'
      ? (title ? `Adding ${title} to queue` : 'Adding to queue')
      : (title ? `Casting ${title}` : 'Casting');
    notifications.show({
      id: 'content-dispatch-confirmation',
      color: 'blue',
      autoClose: 3000,
      title: label,
      message: name ? `To ${name}` : null,
    });
    const targetPayload = verb === 'queue' ? { queue: id } : { play: id };
    Promise.resolve(dispatchToTarget({
      targetIds: castTargetIds,
      ...targetPayload,
      mode: castMode,
      title,
      ...(shuffle ? { shuffle: true } : {}),
    })).then((dispatchIds) => {
      (dispatchIds ?? []).forEach((dispatchId, i) => {
        pendingRef.current.set(dispatchId, castTargetIds[i]);
      });
    });
  }, [dispatchToTarget, devices]);

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
    if (view === 'peek' && params?.deviceId) {
      dispatchToTarget({ targetIds: [params.deviceId], play: id, mode: 'fork', title });
      return 'peek';
    }
    if (targetIds.length > 0) {
      castTo(targetIds, mode, id, title);
      return 'cast';
    }
    queue.playNow(
      { contentId: id, title, thumbnail: item?.thumbnail ?? null },
      { clearRest: true }
    );
    return 'local';
  }, [view, params, push, dispatchToTarget, targetIds, mode, queue, castTo]);

  // The ▶ verb on a container row: explicitly send the WHOLE container to
  // the current destination, replacing the queue. Same destination
  // precedence as leaves (peek wins, then an aimed cast target, then
  // local) — there's just no browse reading of an explicit "send it"
  // action, so that branch is absent here. `opts.shuffle` (Task 15's 🔀
  // verb, see header comment) rides the same three branches; when it's
  // false/omitted every payload is byte-identical to the pre-Task-15 shape.
  const playContainerAsQueue = useCallback((id, item, opts = {}) => {
    const { shuffle = false } = opts;
    const title = item?.title ?? null;
    if (view === 'peek' && params?.deviceId) {
      dispatchToTarget({
        targetIds: [params.deviceId],
        play: id,
        mode: 'fork',
        title,
        ...(shuffle ? { shuffle: true } : {}),
      });
      return 'peek';
    }
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
    return 'local';
  }, [view, params, dispatchToTarget, targetIds, mode, queue, config, castTo]);

  // The + verb on a container row (Task 15): append the WHOLE container to
  // the current destination's queue instead of replacing it. Same
  // destination precedence as ▶, but local calls queue.add and cast/peek
  // send the container as `queue:` (append) rather than `play:` (replace) —
  // see castTo's verb option and the header comment above.
  const addContainerToQueue = useCallback((id, item) => {
    const title = item?.title ?? null;
    if (view === 'peek' && params?.deviceId) {
      dispatchToTarget({ targetIds: [params.deviceId], queue: id, mode: 'fork', title });
      return 'peek';
    }
    if (targetIds.length > 0) {
      castTo(targetIds, mode, id, title, { verb: 'queue' });
      return 'cast';
    }
    const input = (item && resultToQueueInput({ ...item, id: item.id ?? id }))
      ?? { contentId: id, title, thumbnail: item?.thumbnail ?? null };
    queue.add(input);
    return 'local';
  }, [view, params, dispatchToTarget, targetIds, mode, queue, castTo]);

  return useMemo(
    () => ({ dispatch, playContainerAsQueue, addContainerToQueue }),
    [dispatch, playContainerAsQueue, addContainerToQueue]
  );
}

export default useContentDispatch;
