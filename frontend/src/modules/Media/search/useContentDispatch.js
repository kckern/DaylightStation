// frontend/src/modules/Media/search/useContentDispatch.js
// Routes a selected content id to the right playback surface. Precedence:
//   1. `peek` (remote-control) view → cast to the peeked device, mode:'fork'
//      (a remote control must never stop the device it is driving),
//   2. a cast target configured in the dock's chip → cast there in the chip's
//      mode — the chip is a promise about where content goes, and the search
//      bar sits beside it,
//   3. a CONTAINER with no device aimed at it → open the full browse view.
//      Picking "Tuttle Twins" in a search box means "show me the show", not
//      "queue all 24 episodes"; the seasons/episodes belong on the canvas,
//      not in a dropdown that dies on blur (2026-08-12 session review).
//      Note this is deliberately BELOW the two cast branches: with a device
//      aimed, "cast the album/playlist" is still the right read.
//   4. otherwise → play locally, replacing the queue.
// Returns which branch it took so callers can log the destination.
//
// The 'cast' branch (2) is exactly the moment the pre-fix incident was
// about: a tap on a search result went to hidden dock-chip state with no
// acknowledgement at all — success or failure. Two toasts close that gap:
// a synchronous "Casting <title> to <device>" the instant the tap routes
// here (naming the destination the way DestinationLine/CastTargetChip
// already show it), and — once the fleet dispatch actually resolves — a
// failure toast naming the device and the SPECIFIC backend error (never a
// substituted generic string), with Retry re-invoking the exact same
// dispatch via DispatchProvider's retryLast.
import React, { useCallback, useEffect, useRef } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useNav } from '../shell/NavProvider.jsx';
import { useDispatch } from '../cast/DispatchProvider.jsx';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useSessionController } from '../controller/useSessionController.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { deviceName } from '../fleet/deviceDisplay.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { contentIdToBrowsePath } from '../browse/browsePath.js';

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
  const { queue } = useSessionController('local');
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

  return useCallback((id, item) => {
    const title = item?.title ?? null;
    if (view === 'peek' && params?.deviceId) {
      dispatchToTarget({ targetIds: [params.deviceId], play: id, mode: 'fork', title });
      return 'peek';
    }
    if (targetIds.length > 0) {
      const name = namesFor(targetIds, devices);
      notifications.show({
        id: 'content-dispatch-confirmation',
        color: 'blue',
        autoClose: 3000,
        title: title ? `Casting ${title}` : 'Casting',
        message: name ? `To ${name}` : null,
      });
      Promise.resolve(dispatchToTarget({ targetIds, play: id, mode, title })).then((dispatchIds) => {
        (dispatchIds ?? []).forEach((dispatchId, i) => {
          pendingRef.current.set(dispatchId, targetIds[i]);
        });
      });
      return 'cast';
    }
    if (item && isContainer(item)) {
      push('browse', { path: contentIdToBrowsePath(id), label: title ?? id });
      return 'browse';
    }
    queue.playNow(
      { contentId: id, title, thumbnail: item?.thumbnail ?? null },
      { clearRest: true }
    );
    return 'local';
  }, [view, params, push, dispatchToTarget, targetIds, mode, queue, devices]);
}

export default useContentDispatch;
