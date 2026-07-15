// frontend/src/modules/Media/shell/PeekPanel.jsx
// Remote control for one device. Transport uses explicit Play/Pause buttons
// (you command a remote, you don't toggle blind state) with optimistic
// overlay: the predicted state shows instantly, the control locks until the
// device's broadcast confirms (or times out). Seek bar and queue panel are
// the same components Now Playing uses, bound to the remote controller.
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Title, Text, Group, Slider, Stack, Badge } from '@mantine/core';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconVolume,
} from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePeek } from '../peek/PeekProvider.jsx';
import { useDevice } from '../fleet/useDevice.js';
import { deviceName, deviceIcon, deviceLocation } from '../fleet/deviceDisplay.js';
import { useStatusOverlay } from '../../../hooks/useStatusOverlay';
import { useNav } from './NavProvider.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { SeekBar } from './SeekBar.jsx';
import { remoteStatusLine } from './stateCopy.js';

export function PeekPanel({ deviceId }) {
  const { enterPeek, exitPeek } = usePeek();
  useEffect(() => {
    enterPeek(deviceId);
    return () => exitPeek(deviceId);
  }, [deviceId, enterPeek, exitPeek]);

  const ctl = useSessionController({ deviceId });
  const realSnap = ctl.snapshot;
  const { device, entry } = useDevice(deviceId);
  const { pop } = useNav();
  const [volumeScrub, setVolumeScrub] = useState(null);

  // useStatusOverlay is map-based (it can serve multi-device admins); wrap
  // the single device in a one-entry Map.
  const realMap = useMemo(
    () => new Map([[deviceId, realSnap ?? {}]]),
    [deviceId, realSnap],
  );
  const { statusView, predict, pending } = useStatusOverlay(realMap);
  const snap = statusView.get(deviceId);

  const itemTitle = snap?.currentItem?.title ?? snap?.currentItem?.contentId ?? null;
  const statusLine = remoteStatusLine(snap?.state, itemTitle);
  const location = deviceLocation(device);
  const volume = volumeScrub ?? snap?.config?.volume ?? 50;
  const pendingFields = snap?._pending;
  const statePending = pendingFields?.has('state');
  const currentItemPending = pendingFields?.has('currentItem');

  // The transport promise resolves on the device-ack; it rejects on ack
  // timeout (e.g. a device that applied the command but whose ack broadcast
  // didn't round-trip). Correctness never depends on it — the optimistic
  // overlay plus the authoritative device-state broadcast already drive the
  // UI — so swallow the rejection rather than leak an unhandled rejection to
  // the console. A no-op catch keeps the belt-and-suspenders ack without the
  // noise.
  const fire = (thunk) => { try { Promise.resolve(thunk()).catch(() => {}); } catch { /* sync throw */ } };

  const handlePlay = () => { predict(deviceId, { state: 'playing' }); fire(() => ctl.transport.play?.()); };
  const handlePause = () => { predict(deviceId, { state: 'paused' }); fire(() => ctl.transport.pause?.()); };
  const handleStop = () => { predict(deviceId, { state: 'stopped' }); fire(() => ctl.transport.stop?.()); };
  const handleNext = () => { pending(deviceId, ['currentItem']); fire(() => ctl.transport.skipNext?.()); };
  const handlePrev = () => { pending(deviceId, ['currentItem']); fire(() => ctl.transport.skipPrev?.()); };

  return (
    <Stack data-testid="peek-panel" className="peek-panel" gap="md">
      <Group justify="space-between">
        <Button data-testid="peek-back" variant="subtle" color="gray" onClick={() => pop()}>
          ← Devices
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

      <Group className="peek-transport" gap="sm">
        <Button data-testid="peek-play" leftSection={<IconPlayerPlayFilled size={16} />}
                disabled={statePending} data-pending={statePending ? 'true' : undefined}
                onClick={handlePlay}>
          Play
        </Button>
        <Button data-testid="peek-pause" variant="default" leftSection={<IconPlayerPauseFilled size={16} />}
                disabled={statePending} data-pending={statePending ? 'true' : undefined}
                onClick={handlePause}>
          Pause
        </Button>
        <Button data-testid="peek-stop" variant="default" leftSection={<IconPlayerStopFilled size={16} />}
                disabled={statePending} data-pending={statePending ? 'true' : undefined}
                onClick={handleStop}>
          Stop
        </Button>
        <Button data-testid="peek-prev" variant="default" leftSection={<IconPlayerSkipBackFilled size={16} />}
                disabled={currentItemPending} data-pending={currentItemPending ? 'true' : undefined}
                onClick={handlePrev}>
          Prev
        </Button>
        <Button data-testid="peek-next" variant="default" leftSection={<IconPlayerSkipForwardFilled size={16} />}
                disabled={currentItemPending} data-pending={currentItemPending ? 'true' : undefined}
                onClick={handleNext}>
          Next
        </Button>
      </Group>

      {snap?.currentItem && <SeekBar target={{ deviceId }} />}

      <Group gap="xs" className="peek-volume">
        <IconVolume size={18} aria-hidden />
        <Slider
          data-testid="peek-volume"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label="Volume"
          style={{ width: 'min(240px, 60%)' }}
          onChange={setVolumeScrub}
          onChangeEnd={(v) => { fire(() => ctl.config.setVolume?.(v)); setVolumeScrub(null); }}
        />
        <Text size="sm" c="dimmed">{volume}</Text>
      </Group>

      <QueuePanel target={{ deviceId }} />
    </Stack>
  );
}

export default PeekPanel;
