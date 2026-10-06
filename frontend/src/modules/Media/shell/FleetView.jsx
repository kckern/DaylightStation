// frontend/src/modules/Media/shell/FleetView.jsx
// Every configured playback surface, live: state dot (the one stateColor
// source — status can't lie), current item, progress, stale/offline badges.
// Peek opens the remote control; Take Over appears only when a session is
// actually active (portability phase wires the action).
// House additions (P1/P2): every row shows its start progress or last
// failure to everyone (RQ-HOUSE-04), how its playback started (RQ-HOUSE-07),
// Add only with a way to switch it off (RQ-PLAY-10), the notes of a screen
// that can't show them with Put it back (RQ-STEER-21), the "(was …)" of a
// recent rename (RQ-HOUSE-06) and Stop "and turn the screen off" where the
// screen supports it (RQ-STEER-11). The view offers Pause all / Stop all /
// Resume all (RQ-STEER-13) and leads to screen admin and routine history.
import React, { useCallback, useMemo, useState } from 'react';
import { Title, Text, Badge, Button, Progress, Group, Alert, Stack } from '@mantine/core';
import { IconDeviceRemote, IconAlertCircle, IconPlayerPlay, IconPlayerPauseFilled, IconDevices, IconHistory } from '@tabler/icons-react';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { useDevice } from '../fleet/useDevice.js';
import { FleetPlayPicker } from '../fleet/FleetPlayPicker.jsx';
import { deviceName, deviceIcon, deviceLocation } from '../fleet/deviceDisplay.js';
import { useNav } from './NavProvider.jsx';
import { usePeek } from '../peek/usePeek.js';
import { stateColor } from '../theme/mediaTheme.js';
import { deviceStateLabel } from './stateCopy.js';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { deviceKind } from '../cast/castCopy.js';
import { canShowNotes, wasNameLabel } from '../house/houseCopy.js';
import { useStartStatuses, useStartedByAll } from '../house/useHouseSignals.js';
import { useSlideshowStopGuard } from './PlayerFeatureControls.jsx';
import { StartStatusLine, StartedByLine, AddOnlyNotice, RowNotes, ScreenStopControl } from '../house/RowExtras.jsx';
import { HouseQuietBar } from '../house/HouseQuietControls.jsx';
import '../house/House.scss';

const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

function fmt(s) {
  const t = Math.max(0, Math.floor(s ?? 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}

function FleetCard({ deviceId, startStatus, startedBy }) {
  const { device, entry } = useDevice(deviceId);
  const { push } = useNav();
  const { getController } = usePeek();
  // Inline "play something on this device" panel (FleetPlayPicker).
  const [playOpen, setPlayOpen] = useState(false);
  const closePlay = useCallback(() => setPlayOpen(false), []);
  const offline = !!entry?.offline;
  const snap = entry?.snapshot;
  // The merged fleet row's state (browser liveness, or the two-minute
  // uncertainty mergeCanonicalFleetState applies to physical screens) is
  // what the list sorts by — the card must read the same, not the raw
  // snapshot. The offline label still wins below.
  const devState = device?.state ?? snap?.state ?? 'unknown';
  const item = snap?.currentItem;
  const duration = item?.duration ?? 0;
  const isActive = !offline && ACTIVE_STATES.has(devState);
  const location = deviceLocation(device);
  const name = deviceName(device, deviceId);
  const was = wasNameLabel(device);
  const controls = !offline ? snap?.controls ?? null : null;
  // Stopping a slideshow with music behind asks "Keep the music?" here too,
  // and the answer rides the stop command (never inferred from who sent it).
  const [guardStop, stopGuardDialog] = useSlideshowStopGuard({ deviceId }, snap ?? null);
  const sendTransport = (action, opts) => {
    const result = getController(deviceId)?.transport?.[action]?.(opts);
    result?.catch?.(() => {});
  };

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
          <span className="fleet-card-name">
            {name}
            {was && <span className="house-was-name" data-testid={`fleet-was-name-${deviceId}`}> {was}</span>}
          </span>
          {device?.isLocal && (
            <span data-testid={`fleet-this-device-${deviceId}`} className="fleet-card-this-device">This device</span>
          )}
          {location && <span className="fleet-card-location">{location}</span>}
        </span>
        <span className="fleet-card-state" data-testid={`fleet-state-${deviceId}`}>
          {deviceStateLabel(devState, { offline })}
        </span>
        {entry?.isStale && <Badge size="xs" color="yellow" variant="light" className="fleet-card-stale">Out of date</Badge>}
      </div>
      {entry?.isStale && (
        <Text data-testid={`fleet-uncertain-${deviceId}`} size="xs" c="yellow">
          Last heard {entry.lastSeenAt ? new Date(entry.lastSeenAt).toLocaleString() : 'at an unknown time'}; control results may not be confirmed.
        </Text>
      )}
      <StartStatusLine deviceId={deviceId} status={startStatus} kind={deviceKind(device)} />
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
      {isActive && <StartedByLine deviceId={deviceId} info={startedBy ?? null} />}
      <AddOnlyNotice deviceId={deviceId} name={name} controls={controls} />
      {!canShowNotes(device) && <RowNotes deviceId={deviceId} name={name} controls={controls} />}
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
          <>
            <Button data-testid={`fleet-pause-${deviceId}`} size="compact-sm" variant="default" leftSection={<IconPlayerPauseFilled size={14} aria-hidden />} onClick={() => sendTransport('pause')}>
              Pause
            </Button>
            <ScreenStopControl device={device ?? { id: deviceId }} name={name} onStop={() => guardStop((opts) => sendTransport('stop', opts))} />
            {stopGuardDialog}
            <Button
              data-testid={`fleet-takeover-${deviceId}`}
              size="compact-sm"
              variant="light"
              disabled
              title="Move playback is not available yet."
            >
              Move here
            </Button>
            <Text data-testid={`fleet-takeover-unavailable-${deviceId}`} size="xs" c="dimmed">
              Move playback is not available yet.
            </Text>
          </>
        )}
      </Group>
      {playOpen && <FleetPlayPicker deviceId={deviceId} onClose={closePlay} />}
    </li>
  );
}

export function FleetView() {
  const { devices, loading, error, connected, store } = useFleetContext();
  const { push } = useNav();
  const deviceIds = useMemo(() => devices.map((d) => d.id), [devices]);
  const startStatuses = useStartStatuses(deviceIds);
  // What plays where: a change re-reads "Started by" for every row.
  const playingKey = devices.map((d) => {
    const item = store?.getEntry?.(d.id)?.snapshot?.currentItem;
    return `${d.id}:${d.state ?? ''}:${item?.contentId ?? ''}`;
  }).join('|');
  const startedBy = useStartedByAll(playingKey);

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
        Couldn&apos;t load your devices. Check the connection and try again.
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
      <Group justify="space-between" align="center" mb="sm" wrap="wrap" gap="xs">
        <Title order={1}>Devices</Title>
        <Group gap="xs">
          <Button data-testid="fleet-open-screens" variant="subtle" className="house-action" leftSection={<IconDevices size={16} aria-hidden />} onClick={() => push('screens', {})}>
            Screens
          </Button>
          <Button data-testid="fleet-open-routines" variant="subtle" className="house-action" leftSection={<IconHistory size={16} aria-hidden />} onClick={() => push('routines', {})}>
            Routines
          </Button>
        </Group>
      </Group>
      <HouseQuietBar />
      {connected === false && (
        <Alert data-testid="fleet-connection-warning" color="yellow" variant="light" icon={<IconAlertCircle size={18} />}>
          This device has lost touch with the house. Information may be out of date; it will reconnect automatically.
        </Alert>
      )}
      <ul className="fleet-cards">
        {devices.map((d) => (
          <FleetCard key={d.id} deviceId={d.id} startStatus={startStatuses.get(d.id) ?? null} startedBy={startedBy.get(d.id) ?? null} />
        ))}
      </ul>
    </div>
  );
}

export default FleetView;
