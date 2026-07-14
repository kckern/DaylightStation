// frontend/src/modules/Media/shell/FleetView.jsx
// Every configured playback surface, live: state dot (the one stateColor
// source — status can't lie), current item, progress, stale/offline badges.
// Peek opens the remote control; Take Over appears only when a session is
// actually active (portability phase wires the action).
import React, { useCallback, useState } from 'react';
import { Title, Text, Badge, Button, Progress, Group, Skeleton, Alert, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceRemote, IconAlertCircle, IconPlayerPlay } from '@tabler/icons-react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useDevice } from '../fleet/useDevice.js';
import { FleetPlayPicker } from '../fleet/FleetPlayPicker.jsx';
import { deviceName, deviceIcon, deviceLocation } from '../fleet/deviceDisplay.js';
import { useNav } from './NavProvider.jsx';
import { useTakeOver } from '../peek/useTakeOver.js';
import { stateColor } from '../theme/mediaTheme.js';
import { deviceStateLabel } from './stateCopy.js';

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
  // Inline "play something on this device" panel (FleetPlayPicker).
  const [playOpen, setPlayOpen] = useState(false);
  const closePlay = useCallback(() => setPlayOpen(false), []);
  const offline = !!entry?.offline;
  const snap = entry?.snapshot;
  const devState = snap?.state ?? 'unknown';
  const item = snap?.currentItem;
  const duration = item?.duration ?? 0;
  const isActive = !offline && ACTIVE_STATES.has(devState);
  const location = deviceLocation(device);

  return (
    <li data-testid={`fleet-card-${deviceId}`} className="fleet-card">
      <div className="fleet-card-head">
        <span
          className="fleet-card-dot"
          style={{ backgroundColor: stateColor(devState, { offline }), borderColor: offline ? 'currentColor' : 'transparent' }}
          aria-hidden
        />
        <span className="fleet-card-icon" aria-hidden>{deviceIcon(device)}</span>
        <span className="fleet-card-titles">
          <span className="fleet-card-name">{deviceName(device, deviceId)}</span>
          {location && <span className="fleet-card-location">{location}</span>}
        </span>
        <span className="fleet-card-state" data-testid={`fleet-state-${deviceId}`}>
          {deviceStateLabel(devState, { offline })}
        </span>
        {entry?.isStale && <Badge size="xs" color="yellow" variant="light" className="fleet-card-stale">Out of date</Badge>}
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
          <Text size="sm" c="dimmed" className="fleet-card-hint">
            {devState === 'unknown' && !offline
              ? "This device hasn't reported yet"
              : 'Nothing playing right now'}
          </Text>
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
        {/* data-play-toggle lets the panel's outside-tap dismissal ignore
            this button, so a second tap toggles closed instead of
            dismiss-then-reopen. */}
        <Button
          data-testid={`fleet-play-${deviceId}`}
          data-play-toggle={deviceId}
          size="compact-sm"
          variant="default"
          leftSection={<IconPlayerPlay size={16} />}
          aria-expanded={playOpen}
          onClick={() => setPlayOpen((v) => !v)}
        >
          Play…
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
                  title: "Couldn't move playback here",
                  message: result?.error ?? "The other device didn't let go. Try again.",
                });
              }
            }}
          >
            Play here
          </Button>
        )}
      </Group>
      {playOpen && <FleetPlayPicker deviceId={deviceId} onClose={closePlay} />}
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
        Couldn't load your devices. Check the connection and try again.
        <details className="error-detail">
          <summary>Technical details</summary>
          {error.message}
        </details>
      </Alert>
    );
  }
  if (!devices.length) {
    return <Text data-testid="fleet-empty" c="dimmed">No devices set up yet.</Text>;
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
