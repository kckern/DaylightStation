// frontend/src/modules/Media/shell/FleetView.jsx
// Every configured playback surface, live: state dot (the one stateColor
// source — status can't lie), current item, progress, stale/offline badges.
// Peek opens the remote control; Take Over appears only when a session is
// actually active (portability phase wires the action).
import React from 'react';
import { Title, Text, Badge, Button, Progress, Group, Skeleton, Alert, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceRemote, IconAlertCircle } from '@tabler/icons-react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useDevice } from '../fleet/useDevice.js';
import { useNav } from './NavProvider.jsx';
import { useTakeOver } from '../peek/useTakeOver.js';
import { stateColor } from '../theme/mediaTheme.js';

const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

function fmt(s) {
  const t = Math.max(0, Math.floor(s ?? 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}

function FleetCard({ deviceId }) {
  const { device, entry } = useDevice(deviceId);
  const { push } = useNav();
  const takeOver = useTakeOver();
  const offline = !!entry?.offline;
  const snap = entry?.snapshot;
  const devState = snap?.state ?? 'unknown';
  const item = snap?.currentItem;
  const duration = item?.duration ?? 0;
  const isActive = !offline && ACTIVE_STATES.has(devState);

  return (
    <li data-testid={`fleet-card-${deviceId}`} className="fleet-card">
      <div className="fleet-card-head">
        <span
          className="fleet-card-dot"
          style={{ backgroundColor: stateColor(devState, { offline }), borderColor: offline ? 'currentColor' : 'transparent' }}
          aria-hidden
        />
        <span className="fleet-card-name">{device?.name ?? deviceId}</span>
        <span className="fleet-card-state" data-testid={`fleet-state-${deviceId}`}>
          {offline ? `offline (last: ${devState})` : devState}
        </span>
        {entry?.isStale && <Badge size="xs" color="yellow" variant="light" className="fleet-card-stale">stale</Badge>}
      </div>
      <div className="fleet-card-item">
        {item ? (
          <>
            {item.thumbnail && <img className="fleet-card-thumb" src={item.thumbnail} alt="" loading="lazy" />}
            <div className="fleet-card-item-meta">
              <Text size="sm" fw={600} lineClamp={1}>{item.title ?? item.contentId}</Text>
              {duration > 0 && (
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">{fmt(snap.position)}</Text>
                  <Progress value={(100 * (snap.position ?? 0)) / duration} size="xs" style={{ flex: 1 }} />
                  <Text size="xs" c="dimmed">{fmt(duration)}</Text>
                </Group>
              )}
            </div>
          </>
        ) : (
          <Text size="sm" c="dimmed">—</Text>
        )}
      </div>
      <Group gap="xs" className="fleet-card-actions">
        <Button
          data-testid={`fleet-peek-${deviceId}`}
          size="compact-sm"
          variant="default"
          leftSection={<IconDeviceRemote size={16} />}
          onClick={() => push('peek', { deviceId })}
        >
          Remote
        </Button>
        {isActive && (
          <Button
            data-testid={`fleet-takeover-${deviceId}`}
            size="compact-sm"
            variant="light"
            onClick={async () => {
              const result = await takeOver(deviceId);
              if (!result?.ok) {
                // C7.4: the user MUST be informed when a take-over fails.
                notifications.show({
                  color: 'red',
                  title: 'Take Over failed',
                  message: result?.error ?? 'Device did not release its session.',
                });
              }
            }}
          >
            Take Over
          </Button>
        )}
      </Group>
    </li>
  );
}

export function FleetView() {
  const { devices, loading, error } = useFleetContext();

  if (loading) {
    return (
      <Stack data-testid="fleet-loading" gap="sm">
        {[0, 1, 2].map((i) => <Skeleton key={i} height={120} radius="md" />)}
      </Stack>
    );
  }
  if (error) {
    return (
      <Alert data-testid="fleet-error" color="red" variant="light" icon={<IconAlertCircle size={18} />}>
        {error.message}
      </Alert>
    );
  }
  if (!devices.length) {
    return <Text data-testid="fleet-empty" c="dimmed">No playback devices configured.</Text>;
  }

  return (
    <div data-testid="fleet-view" className="fleet-view">
      <Title order={1} mb="md">Devices</Title>
      <ul className="fleet-cards">
        {devices.map((d) => <FleetCard key={d.id} deviceId={d.id} />)}
      </ul>
    </div>
  );
}

export default FleetView;
