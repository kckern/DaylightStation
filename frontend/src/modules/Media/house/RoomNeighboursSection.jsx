// frontend/src/modules/Media/house/RoomNeighboursSection.jsx
// Which rooms are next to which (PLACE.4a/AC6, RQ-PLACE-10): screens started
// together in the same or a neighbouring room can drift apart audibly, and the
// Play-on picker warns about it. The rooms are the ones the screens already
// have; a neighbour link is mutual and is kept in the screen registry.
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { IconDoor } from '@tabler/icons-react';
import { useDismissLayer } from '../shell/useDismissLayer.js';

const key = (room) => String(room).trim().toLowerCase();

/** Distinct room names across screens (first spelling wins), sorted. */
export function roomsOf(screens = []) {
  const seen = new Map();
  for (const screen of screens) {
    const room = typeof screen?.room === 'string' ? screen.room.trim() : '';
    if (room && !seen.has(key(room))) seen.set(key(room), room);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function neighboursOf(adjacency = {}, room) {
  const mine = key(room);
  const out = new Map();
  for (const [a, list] of Object.entries(adjacency)) {
    if (key(a) === mine) for (const b of list ?? []) out.set(key(b), b);
    else if ((list ?? []).some((b) => key(b) === mine)) out.set(key(a), a);
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

function NeighboursDialog({ room, rooms, current, onClose, onSave }) {
  const open = !!room;
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useDismissLayer(open, onClose, { managed: true });
  useEffect(() => { setChosen(current.map(key)); setError(null); }, [room]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = rooms.filter((r) => key(r) !== key(room ?? ''));
  const save = async () => {
    setBusy(true);
    const result = await onSave(room, others.filter((r) => chosen.includes(key(r))));
    setBusy(false);
    if (result?.ok) onClose(); else setError(result?.error ?? 'Something went wrong');
  };
  return (
    <Modal opened={open} onClose={onClose} title={room ? `Rooms next to ${room}` : ''} centered>
      <Stack gap="sm" data-testid="room-neighbours-dialog">
        <Text size="sm">Screens started together in neighbouring rooms are warned they may drift apart.</Text>
        {others.map((other) => (
          <Checkbox
            key={other}
            label={other}
            size="md"
            checked={chosen.includes(key(other))}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              setChosen((c) => (on ? [...c, key(other)] : c.filter((k) => k !== key(other))));
            }}
            data-testid={`room-neighbour-option-${key(other)}`}
          />
        ))}
        {error && <Text size="sm" className="house-tone--failed" role="alert">{error}</Text>}
        <Group justify="flex-end">
          <Button variant="default" className="house-action" onClick={onClose}>Cancel</Button>
          <Button className="house-action" loading={busy} onClick={save} data-testid="room-neighbours-save">Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function RoomNeighboursSection({ screens, adjacency, admin }) {
  const rooms = useMemo(() => roomsOf(screens), [screens]);
  const [editing, setEditing] = useState(null);
  if (rooms.length < 2) return null;
  return (
    <section className="house-section" aria-labelledby="screen-admin-rooms-title" data-testid="screen-admin-rooms">
      <Title order={2} size="h4" id="screen-admin-rooms-title">Rooms next to each other</Title>
      <ul className="house-list">
        {rooms.map((room) => {
          const near = neighboursOf(adjacency, room);
          return (
            <li key={room} className="house-item" data-testid={`screen-admin-room-${key(room)}`}>
              <div className="house-item-head">
                <Text fw={600}>{room}</Text>
                <Text size="sm" c="dimmed" data-testid={`screen-admin-room-near-${key(room)}`}>
                  {near.length ? `Next to ${near.join(', ')}` : 'No neighbours set'}
                </Text>
              </div>
              <div className="house-item-actions">
                <Button size="xs" variant="default" className="house-action" leftSection={<IconDoor size={14} aria-hidden />}
                  data-testid={`screen-admin-room-edit-${key(room)}`} onClick={() => setEditing(room)}>
                  Neighbours
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <NeighboursDialog
        room={editing}
        rooms={rooms}
        current={editing ? neighboursOf(adjacency, editing) : []}
        onClose={() => setEditing(null)}
        onSave={admin.setNeighbours}
      />
    </section>
  );
}

export default RoomNeighboursSection;
