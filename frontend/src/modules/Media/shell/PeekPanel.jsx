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
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useDevice } from '../fleet/useDevice.js';
import { useStatusOverlay } from '../../../hooks/useStatusOverlay';
import { useNav } from './NavProvider.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { SeekBar } from './SeekBar.jsx';

export function PeekPanel({ deviceId }) {
  const { enterPeek, exitPeek } = usePeek();
  useEffect(() => {
    enterPeek(deviceId);
    return () => exitPeek(deviceId);
  }, [deviceId, enterPeek, exitPeek]);

  const ctl = useSessionController({ deviceId });
  const realSnap = ctl.snapshot;
  const { devices } = useFleetContext();
  const { entry } = useDevice(deviceId);
  const deviceName = devices?.find((d) => d.id === deviceId)?.name ?? deviceId;
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

  const stateLabel = snap?.state ?? 'unknown';
  const itemLabel = snap?.currentItem?.title ?? snap?.currentItem?.contentId ?? 'nothing';
  const volume = volumeScrub ?? snap?.config?.volume ?? 50;
  const pendingFields = snap?._pending;
  const statePending = pendingFields?.has('state');
  const currentItemPending = pendingFields?.has('currentItem');

  const handlePlay = () => { predict(deviceId, { state: 'playing' }); ctl.transport.play?.(); };
  const handlePause = () => { predict(deviceId, { state: 'paused' }); ctl.transport.pause?.(); };
  const handleStop = () => { predict(deviceId, { state: 'stopped' }); ctl.transport.stop?.(); };
  const handleNext = () => { pending(deviceId, ['currentItem']); ctl.transport.skipNext?.(); };
  const handlePrev = () => { pending(deviceId, ['currentItem']); ctl.transport.skipPrev?.(); };

  return (
    <Stack data-testid="peek-panel" className="peek-panel" gap="md">
      <Group justify="space-between">
        <Button data-testid="peek-back" variant="subtle" color="gray" onClick={() => pop()}>
          ← Fleet
        </Button>
        {entry?.isStale && <Badge color="yellow" variant="light">stale</Badge>}
        {entry?.offline && <Badge color="gray" variant="light">offline</Badge>}
      </Group>

      <Title order={1}>Remote: {deviceName}</Title>

      <Group gap="lg">
        <Text size="sm" c="dimmed" data-pending={statePending ? 'true' : undefined}>
          state: <Text span fw={600} c="bright">{stateLabel}</Text>
        </Text>
        <Text size="sm" c="dimmed" data-pending={currentItemPending ? 'true' : undefined}>
          item: <Text span fw={600} c="bright">{itemLabel}</Text>
        </Text>
      </Group>

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
          onChangeEnd={(v) => { ctl.config.setVolume?.(v); setVolumeScrub(null); }}
        />
        <Text size="sm" c="dimmed">{volume}</Text>
      </Group>

      <QueuePanel target={{ deviceId }} />
    </Stack>
  );
}

export default PeekPanel;
