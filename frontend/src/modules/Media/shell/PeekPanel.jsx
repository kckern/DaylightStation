// frontend/src/modules/Media/shell/PeekPanel.jsx
// Remote control for one device. The shared TransportBar remains target-bound;
// this panel supplies only the remote overlay policy (predicted state and
// pending fields) rather than a second set of transport controls.
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Title, Text, Group, Stack, Badge } from '@mantine/core';
import { useSessionController } from '../controller/useSessionController.js';
import { usePeek } from '../peek/usePeek.js';
import { useDevice } from '../fleet/useDevice.js';
import { deviceName, deviceIcon, deviceLocation } from '../fleet/deviceDisplay.js';
import { useStatusOverlay } from '../../../hooks/useStatusOverlay';
import { useNav } from './NavProvider.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { SeekBar } from './SeekBar.jsx';
import { TransportBar } from './TransportBar.jsx';
import { remoteStatusLine } from './stateCopy.js';
import { useRemoteStopFeedback } from './useRemoteStopFeedback.js';
import { SessionControlFrame } from '../controller/SessionControlFrame.jsx';
import { GlobalAimLabel } from '../cast/AimLabel.jsx';

export function PeekPanel({ deviceId }) {
  const { enterPeek, exitPeek } = usePeek();
  useEffect(() => {
    enterPeek(deviceId);
    return () => exitPeek(deviceId);
  }, [deviceId, enterPeek, exitPeek]);

  const ctl = useSessionController({ deviceId });
  const realSnap = ctl.snapshot;
  const { device, entry } = useDevice(deviceId);
  const { pop, backDestination } = useNav();
  const queueRef = useRef(null);
  const { queueKeptCount, noteStop } = useRemoteStopFeedback(deviceId, realSnap, entry);

  // useStatusOverlay is map-based (it can serve multi-device admins); wrap
  // the single device in a one-entry Map.
  const realMap = useMemo(
    () => new Map([[deviceId, realSnap ?? {}]]),
    [deviceId, realSnap],
  );
  const { statusView, predict, pending, pendingMatch } = useStatusOverlay(realMap);
  const snap = statusView.get(deviceId);

  const itemTitle = snap?.currentItem?.title ?? snap?.currentItem?.contentId ?? null;
  const statusLine = remoteStatusLine(snap?.state, itemTitle);
  const location = deviceLocation(device);
  const pendingFields = snap?._pending;
  const statePending = pendingFields?.has('state');
  const currentItemPending = pendingFields?.has('currentItem');
  const availability = useMemo(() => {
    if (entry?.offline) return { available: false, reason: 'This device is offline' };
    if (entry?.isStale) return { available: false, reason: 'This device state is out of date' };
    if (!realSnap) return { available: false, reason: 'Playback state is unavailable for this device' };
    return { available: true };
  }, [entry?.isStale, entry?.offline, realSnap]);

  // Return the actual ack promise to TransportBar. It displays a plain failure
  // when an optimistic remote command cannot be confirmed; swallowing it here
  // would make a rejected command look like success.
  const handleCommand = useCallback((action, invoke, value = null) => {
    if (action === 'play') predict(deviceId, { state: 'playing' });
    if (action === 'pause') predict(deviceId, { state: 'paused' });
    if (action === 'stop') {
      const result = invoke();
      noteStop(result);
      return result;
    }
    if (action === 'seekAbs') {
      pendingMatch(deviceId, 'position', (position) => Number.isFinite(position)
        && Number.isFinite(value) && Math.abs(position - value) <= 2);
    }
    if (action === 'skipNext' || action === 'skipPrev') pending(deviceId, ['currentItem']);
    return invoke();
  }, [deviceId, noteStop, pending, pendingMatch, predict]);

  const pendingActions = useMemo(() => ({
    play: statePending,
    pause: statePending,
    stop: statePending,
    skipNext: currentItemPending,
    skipPrev: currentItemPending,
    seekAbs: pendingFields?.has('position') === true,
  }), [currentItemPending, pendingFields, statePending]);

  return (
    <Stack data-testid="peek-panel" className="peek-panel" gap="md">
      <Group justify="space-between">
        <Button data-testid="peek-back" variant="subtle" color="gray" onClick={() => pop()}>
          ← {backDestination ?? 'Home'}
        </Button>
        {entry?.isStale && <Badge color="yellow" variant="light">Out of date</Badge>}
        {entry?.offline && <Badge color="gray" variant="light">Offline</Badge>}
      </Group>

      <Title order={1} className="peek-title">
        <span aria-hidden>{deviceIcon(device)}</span> {deviceName(device, deviceId)}
      </Title>
      {location && <Text size="sm" c="dimmed" className="peek-location">{location}</Text>}

      <Text
        size="sm"
        className="peek-status"
        data-pending={statePending || currentItemPending ? 'true' : undefined}
      >
        {statusLine}
      </Text>

      <GlobalAimLabel />

      <SessionControlFrame targetKind="remote">
      {snap?.currentItem && <SeekBar
        target={{ deviceId }}
        availability={availability}
        onCommand={handleCommand}
        pendingAction={pendingActions.seekAbs}
      />}

      <TransportBar
        target={{ deviceId }}
        snapshot={snap}
        targetLabel={`${deviceIcon(device)} ${deviceName(device, deviceId)}`}
        onCommand={handleCommand}
        pendingActions={pendingActions}
        availability={availability}
      />

      {queueKeptCount != null && (
        <Group data-testid="peek-queue-kept" role="status" gap="xs">
          <Text>Queue kept: {queueKeptCount} item{queueKeptCount === 1 ? '' : 's'}</Text>
          <Button
            data-testid="peek-open-queue"
            size="compact-sm"
            variant="subtle"
            onClick={() => {
              queueRef.current?.scrollIntoView?.({ block: 'start' });
              queueRef.current?.focus?.();
            }}
          >
            Open queue
          </Button>
        </Group>
      )}

      <div ref={queueRef} tabIndex={-1}>
        <QueuePanel target={{ deviceId }} availability={availability} />
      </div>
      </SessionControlFrame>
    </Stack>
  );
}

export default PeekPanel;
