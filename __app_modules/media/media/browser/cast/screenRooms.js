// frontend/src/modules/Media/cast/screenRooms.js
// Project the Fleet screen registry snapshot for the several-screen drift
// warning (PLACE.4a/AC6, RQ-PLACE-10).
//
// The registry names a room per screen and records which rooms neighbour
// which (`roomAdjacency`, set in screen admin), so the warning covers screens
// in the same room and in neighbouring rooms. A screen the registry does not
// know falls back to its configured fleet location. The rooms Map carries the
// adjacency as `rooms.adjacency` (lower-case room → Set of lower-case rooms).
import { deviceLocation, deviceName } from "../fleet/deviceDisplay.js";

const bareId = (id) => String(id ?? '').replace(/^fleet:/, '');
const norm = (room) => String(room ?? '').trim().toLowerCase();

/** Map of bare fleet device ids and browser ids to rooms for active screens. */
export function screenRoomsFromRegistry(registry) {
  const rooms = new Map();
  for (const screen of Array.isArray(registry?.screens) ? registry.screens : []) {
    const room = typeof screen?.room === 'string' ? screen.room.trim() : '';
    if (!room) continue;
    rooms.set(bareId(screen.id), room);
    if (screen.screenId) rooms.set(String(screen.screenId), room);
    for (const alias of Array.isArray(screen.aliases) ? screen.aliases : []) rooms.set(bareId(alias), room);
  }
  const adjacency = new Map();
  for (const [room, list] of Object.entries(registry?.roomAdjacency ?? {})) {
    const key = norm(room);
    const neighbours = adjacency.get(key) ?? new Set();
    for (const other of Array.isArray(list) ? list : []) neighbours.add(norm(other));
    adjacency.set(key, neighbours);
  }
  rooms.adjacency = adjacency;
  return rooms;
}

/**
 * Screens among `targetIds` that share a room, as groups of display names:
 * `[{ room, names: ['Den TV', 'Den speaker'] }]`. Empty when none do.
 */
export function sharedRoomGroups(targetIds = [], devices = [], rooms = new Map()) {
  const byRoom = new Map();
  for (const id of targetIds) {
    const device = devices.find((candidate) => candidate.id === id) ?? null;
    const room = rooms.get(bareId(id)) || deviceLocation(device) || device?.room || '';
    if (!norm(room)) continue;
    const key = norm(room);
    if (!byRoom.has(key)) byRoom.set(key, { room: room.trim(), names: [] });
    byRoom.get(key).names.push(deviceName(device, id));
  }
  return [...byRoom.values()].filter((group) => group.names.length > 1);
}

/**
 * Screens among `targetIds` whose rooms neighbour each other (never the same
 * room: those are `sharedRoomGroups`): `[{ rooms: ['Den', 'Kitchen'], names: [...] }]`.
 */
export function neighbouringRoomGroups(targetIds = [], devices = [], rooms = new Map()) {
  const adjacency = rooms.adjacency;
  if (!adjacency?.size) return [];
  const byRoom = new Map();
  for (const id of targetIds) {
    const device = devices.find((candidate) => candidate.id === id) ?? null;
    const room = rooms.get(bareId(id)) || deviceLocation(device) || device?.room || '';
    if (!norm(room)) continue;
    const key = norm(room);
    if (!byRoom.has(key)) byRoom.set(key, { room: room.trim(), names: [] });
    byRoom.get(key).names.push(deviceName(device, id));
  }
  const keys = [...byRoom.keys()].sort();
  const out = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      if (!adjacency.get(keys[i])?.has(keys[j]) && !adjacency.get(keys[j])?.has(keys[i])) continue;
      const a = byRoom.get(keys[i]);
      const b = byRoom.get(keys[j]);
      out.push({ rooms: [a.room, b.room], names: [...a.names, ...b.names] });
    }
  }
  return out;
}

export function driftWarningText(groups, neighbours = []) {
  if (!groups.length && !neighbours.length) return null;
  const parts = groups.map(({ room, names }) => `${names.join(' and ')} are ${names.length === 2 ? 'both' : 'all'} in ${room}`);
  for (const { rooms, names } of neighbours) parts.push(`${names.join(' and ')} are in neighbouring rooms (${rooms.join(' and ')})`);
  return `${parts.join('; ')} — they start together but can drift apart, and you may hear it.`;
}
