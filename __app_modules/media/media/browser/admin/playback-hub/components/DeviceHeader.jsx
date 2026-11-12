import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Stack, Text, Badge, Avatar, Button } from '@mantine/core';
import {
  IconBluetooth,
  IconBluetoothOff,
  IconPlayerPauseFilled,
} from '@tabler/icons-react';
import getLogger from "../../../../../../../frontend/src/lib/logging/Logger.js";

// Colour per hub status_code (playing|idle|absent|unpaired|unknown).
const STATUS_COLOR = {
  playing: 'green.6', idle: 'blue.4', absent: 'dimmed', unpaired: 'red.6', unknown: 'orange.6',
};
const FIX_RESULT_MS = 60000;

/**
 * useFix — state for the owner's one Fix button: asks the hub to reconnect the speaker,
 * restart the slot's player if needed and replay (or start a 2-minute pairing
 * scan), then shows the hub's one plain line until the next status settles.
 */
function useFix(color, onFix) {
  const logger = useMemo(() => getLogger().child({ component: 'hub-fix-button' }), []);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async () => {
    setBusy(true);
    setLine('Working on it…');
    logger.info('fix.click', { color });
    let out;
    try {
      out = await onFix?.();
    } catch (err) {
      out = { ok: false, result: err?.message || 'The hub did not answer.' };
    }
    logger.info('fix.result', { color, ok: out?.ok, code: out?.code, result: out?.result });
    setBusy(false);
    setLine(out?.result || out?.error || 'Done.');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLine(null), FIX_RESULT_MS);
  };

  return { busy, line, run };
}

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
export function DeviceHeader({ slot, status, onFix }) {
  const fixState = useFix(slot?.color, onFix);
  const fix = onFix ? fixState : null;
  const word = typeof status?.status === 'string' ? status.status : null;
  const wordColor = STATUS_COLOR[status?.status_code] ?? 'dimmed';
  const detail = fix?.line ?? status?.status_detail ?? null;
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
            {word ? (
              <>
                {btConnected ? <IconBluetooth size={14} /> : <IconBluetoothOff size={14} />}
                <Text size="sm" fw={700} c={wordColor} data-testid="hub-slot-status">{word}</Text>
              </>
            ) : btConnected ? (
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
        {(word || fix?.line) && detail ? (
          <Text size="xs" c="dimmed" data-testid="hub-slot-detail">{detail}</Text>
        ) : null}
      </Stack>
      {fix ? (
        <Button
          size="xs"
          variant="light"
          loading={fix.busy}
          onClick={fix.run}
          aria-label={`fix ${slot.color}`}
        >
          Fix
        </Button>
      ) : null}
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
