// frontend/src/modules/Media/house/RowExtras.jsx
// The lines a house-view row carries beyond state and item:
//  StartStatusLine — start progress / last failure, for everyone (RQ-HOUSE-04)
//  StartedByLine   — "Started by Kitchen button, 7:02" (RQ-HOUSE-07); also
//                    mountable in a screen's controls header (pass deviceId)
//  AddOnlyNotice   — Add only is on, and anyone can switch it off (RQ-PLAY-10)
//  RowNotes        — notes of a screen that can't show them, grouped, with
//                    Put it back (RQ-STEER-21)
//  ScreenStopControl — Stop, plus "and turn the screen off" where supported
//                    (RQ-STEER-11)
import React, { useEffect, useReducer, useState } from 'react';
import { Button, Group, Menu, Text } from '@mantine/core';
import { IconChevronDown, IconPlayerStopFilled, IconPower, IconArrowBackUp } from '@tabler/icons-react';
import { startStatusLine, startedByText, rowNotes } from './houseCopy.js';
import { useStartedBy } from './useHouseSignals.js';
import { useScreenActions, supportsScreenOff } from './screenActions.js';
import './House.scss';

const TONE_CLASS = { progress: 'house-line--progress', ok: 'house-line--ok', failed: 'house-line--failed' };

// Re-render when a time-boxed line (Started, Put it back) should change.
function useExpiry(atMs) {
  const [, tick] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!Number.isFinite(atMs)) return undefined;
    const delay = atMs - Date.now();
    if (delay <= 0) return undefined;
    const timer = setTimeout(tick, delay + 5);
    return () => clearTimeout(timer);
  }, [atMs]);
}

export function StartStatusLine({ deviceId, status, kind }) {
  const updated = Date.parse(status?.updatedAt ?? '');
  useExpiry(Number.isFinite(updated) ? updated + 60_000 : NaN);
  const line = startStatusLine(status, { kind });
  if (!line) return null;
  return (
    <Text
      size="xs"
      data-testid={`house-start-status-${deviceId}`}
      data-tone={line.tone}
      className={`house-line ${TONE_CLASS[line.tone] ?? ''}`}
      role={line.tone === 'failed' ? 'status' : undefined}
    >
      {line.text}
    </Text>
  );
}

/** Pass `info` (from the house list) or let it read the screen itself. */
export function StartedByLine({ deviceId, info, contentId = null }) {
  const own = useStartedBy(info === undefined ? deviceId : null, { contentId });
  const text = startedByText(info === undefined ? own : info);
  if (!text) return null;
  return (
    <Text size="xs" c="dimmed" data-testid={`house-started-by-${deviceId}`} className="house-line">
      {text}
    </Text>
  );
}

export function AddOnlyNotice({ deviceId, name, controls }) {
  const { addOnlyOff } = useScreenActions();
  const [busy, setBusy] = useState(false);
  if (!controls?.addOnly) return null;
  return (
    <Group gap="xs" wrap="nowrap" className="house-notice" data-testid={`house-add-only-${deviceId}`}>
      <Text size="xs" className="house-notice-text">Add only is on: Play from other devices adds to the queue.</Text>
      <Button
        size="xs"
        variant="default"
        className="house-action"
        data-testid={`house-add-only-off-${deviceId}`}
        loading={busy}
        onClick={async () => { setBusy(true); await addOnlyOff({ deviceId, name }); setBusy(false); }}
      >
        Turn off
      </Button>
    </Group>
  );
}

export function RowNotes({ deviceId, name, controls }) {
  const { putBack } = useScreenActions();
  const notes = rowNotes(controls);
  const nextExpiry = Math.min(...(controls?.notes ?? [])
    .map((n) => Date.parse(n.putBack?.availableUntil ?? ''))
    .filter((t) => Number.isFinite(t) && t > Date.now()));
  useExpiry(nextExpiry);
  if (!notes.length) return null;
  return (
    <ul className="house-notes" data-testid={`house-notes-${deviceId}`} aria-label={`Changes to ${name}`}>
      {notes.map((note) => (
        <li key={note.id} className="house-note" data-testid={`house-note-${deviceId}-${note.id}`}>
          <Text size="xs" className="house-note-text">{note.text}</Text>
          {note.putBack && (
            <Button
              size="xs"
              variant="light"
              className="house-action"
              leftSection={<IconArrowBackUp size={14} aria-hidden />}
              data-testid={`house-put-back-${deviceId}-${note.id}`}
              onClick={() => putBack({ deviceId, name, noteId: note.id })}
            >
              Put it back
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Stop (queue kept); where the screen supports it, also "and turn the screen off". */
export function ScreenStopControl({ device, name, onStop }) {
  const { stopAndTurnOff } = useScreenActions();
  const deviceId = device?.id;
  const stop = (
    <Button
      data-testid={`fleet-stop-${deviceId}`}
      size="compact-sm"
      variant="default"
      className="house-action"
      leftSection={<IconPlayerStopFilled size={14} aria-hidden />}
      onClick={onStop}
    >
      Stop
    </Button>
  );
  if (!supportsScreenOff(device)) return stop;
  return (
    <Button.Group>
      {stop}
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button
            size="compact-sm"
            variant="default"
            className="house-action house-action--icon"
            aria-label={`More ways to stop ${name}`}
            data-testid={`fleet-stop-more-${deviceId}`}
          >
            <IconChevronDown size={14} aria-hidden />
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            data-testid={`fleet-stop-off-${deviceId}`}
            leftSection={<IconPower size={16} aria-hidden />}
            onClick={() => stopAndTurnOff({ deviceId, name })}
          >
            Stop and turn the screen off
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Button.Group>
  );
}
