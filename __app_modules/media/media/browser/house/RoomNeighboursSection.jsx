// frontend/src/modules/Media/house/RoomNeighboursSection.jsx
// Which rooms are next to which (PLACE.4a/AC6, RQ-PLACE-10): screens started
// together in the same or a neighbouring room can drift apart audibly, and the
// Play-on picker warns about it. The rooms are the ones the screens already
// have; a neighbour link is mutual and is kept in the screen registry.
import React, { useMemo, useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { IconDoor } from '@tabler/icons-react';
import { useDismissLayer } from "@/lib/ui/dismiss/useDismissLayer.js";
import { useSheetSubmission } from "@/lib/ui/useSheetSubmission.js";

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

function NeighboursForm({ room, rooms, current, onClose, onSave, savePending }) {
  const [edits, setEdits] = useState(() => new Map());
  const confirmed = new Set(current.map(key));
  // Other rooms' saves can confirm mutual links while this form is open.
  const isChosen = other => edits.get(key(other)) ?? confirmed.has(key(other));
  const { submit, saving, failure } = useSheetSubmission(onClose);
  const others = rooms.filter(other => key(other) !== key(room));
  const save = async () => {
    const result = await onSave(room, others.filter(isChosen));
    if (!result?.ok) throw new Error(result?.error ?? 'Something went wrong');
  };
  return (
    <Stack component="form" gap="sm" data-testid="room-neighbours-dialog" onSubmit={event => submit(event, save, !savePending)}>
      <Text size="sm">Screens started together in neighbouring rooms are warned they may drift apart.</Text>
      {others.map(other => (
        <Checkbox
          key={other}
          label={other}
          size="md"
          checked={isChosen(other)}
          onChange={event => {
            const on = event.currentTarget.checked;
            const id = key(other);
            setEdits(previous => {
              const next = new Map(previous);
              if (on === confirmed.has(id)) next.delete(id);
              else next.set(id, on);
              return next;
            });
          }}
          data-testid={`room-neighbour-option-${key(other)}`}
        />
      ))}
      {failure && <Text size="sm" className="house-tone--failed" role="alert">{failure.message}</Text>}
      <Group justify="flex-end">
        <Button type="button" variant="default" className="house-action" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="house-action" loading={saving} disabled={savePending} data-testid="room-neighbours-save">Save</Button>
      </Group>
    </Stack>
  );
}

export function RoomNeighboursSection({ screens, adjacency, savePending, admin }) {
  const rooms = useMemo(() => roomsOf(screens), [screens]);
  const [editing, setEditing] = useState(null);
  const close = () => setEditing(null);
  const open = Boolean(editing) && rooms.length >= 2;
  const usesDismissStack = useDismissLayer(open, close);
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
                  data-testid={`screen-admin-room-edit-${key(room)}`} onClick={event => {
                    event.currentTarget.focus({ preventScroll: true });
                    setEditing(room);
                  }}>
                  Neighbours
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal
        opened={open}
        onClose={close}
        closeOnEscape={!usesDismissStack}
        title={editing ? `Rooms next to ${editing}` : ''}
        centered
      >
        {editing && (
          <NeighboursForm
            key={editing}
            room={editing}
            rooms={rooms}
            current={neighboursOf(adjacency, editing)}
            savePending={savePending}
            onClose={close}
            onSave={admin.setNeighbours}
          />
        )}
      </Modal>
    </section>
  );
}

export default RoomNeighboursSection;
