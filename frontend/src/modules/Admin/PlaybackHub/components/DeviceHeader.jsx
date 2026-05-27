import React from 'react';
import { Group, Stack, Text, Badge, Avatar } from '@mantine/core';
import {
  IconBluetooth,
  IconBluetoothOff,
  IconPlayerPauseFilled,
} from '@tabler/icons-react';

/**
 * DeviceHeader — always-visible header for a device card.
 *
 * Cross-source render: pulls live state from `status` (bt_connected, paused,
 * now_playing, volume) AND limits from `slot` (volume.max for the gauge).
 *
 * Interstitial state: when a status field appears in `status._pending` the
 * corresponding cell renders with `data-pending="true"` so CSS can dim it,
 * signalling that the operator's last command hasn't yet been confirmed by
 * the broadcaster.
 */
export function DeviceHeader({ slot, status }) {
  const volMax = slot?.volume?.max ?? 100;
  const volCurrent = status?.volume ?? slot?.volume?.default ?? 0;
  const nowTitle = status?.now_playing?.title ?? null;
  const isPlaying = !!status?.now_playing;
  const isPaused = status?.paused === true;
  const btConnected = status?.bt_connected === true;

  const pendingFields = status?._pending;
  const nowPlayingPending = pendingFields?.has('now_playing');
  const pausedPending = pendingFields?.has('paused');
  const volumePending = pendingFields?.has('volume');

  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Avatar
            size="sm"
            radius="xl"
            color={slot.color}
            style={{ backgroundColor: slot.color }}
            aria-label={`slot ${slot.color}`}
          >
            {' '}
          </Avatar>
          <Text fw={600}>{slot.color}</Text>
          <Text size="sm" c="dimmed">·</Text>
          {slot.name && <Text size="sm">{slot.name}</Text>}
          <Badge size="xs" variant="light" color={slot.class === 'public' ? 'blue' : 'gray'}>
            {slot.class}
          </Badge>
        </Group>
        <Group gap="md" wrap="nowrap">
          <Group gap={4} wrap="nowrap">
            {btConnected ? (
              <>
                <IconBluetooth size={14} />
                <Text size="xs" c="dimmed">BT ✓</Text>
              </>
            ) : (
              <>
                <IconBluetoothOff size={14} />
                <Text size="xs" c="dimmed">BT ✗</Text>
              </>
            )}
          </Group>
          <Text
            size="xs"
            c="dimmed"
            truncate
            data-pending={nowPlayingPending ? 'true' : undefined}
          >
            {isPlaying ? (
              <>
                Now: <Text component="span" inherit fw={500}>{nowTitle || '(untitled)'}</Text>
              </>
            ) : (
              '— idle —'
            )}
          </Text>
          {isPaused && (
            <Group
              gap={2}
              wrap="nowrap"
              data-pending={pausedPending ? 'true' : undefined}
            >
              <IconPlayerPauseFilled size={12} />
              <Text size="xs" c="yellow.6">paused</Text>
            </Group>
          )}
        </Group>
      </Stack>
      <Stack
        gap={0}
        align="flex-end"
        data-pending={volumePending ? 'true' : undefined}
      >
        <Text size="sm" fw={500} ff="monospace">{volCurrent}/{volMax}</Text>
        <Text size="xs" c="dimmed">vol</Text>
      </Stack>
    </Group>
  );
}

export default DeviceHeader;
