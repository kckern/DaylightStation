// frontend/src/modules/Media/cast/screenRooms.js
// Rooms of the household's screens, from the screen registry
// (GET /api/v1/media/screens, tech doc §2.5), for the several-screen drift
// warning (PLACE.4a/AC6, RQ-PLACE-10): screens started together drift apart,
// and in the same room that drift is audible.
//
// The registry names a room per screen and records which rooms neighbour
// which (`roomAdjacency`, set in screen admin), so the warning covers screens
// in the same room and in neighbouring rooms. A screen the registry does not
// know falls back to its configured fleet location. The rooms Map carries the
// adjacency as `rooms.adjacency` (lower-case room → Set of lower-case rooms).
import { useEffect, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { deviceLocation, deviceName } from '../fleet/deviceDisplay.js';
import mediaLog from '../logging/mediaLog.js';

const CACHE_MS = 60_000;
let cache = null; // { at, promise }

const bareId = (id) => String(id ?? '').replace(/^fleet:/, '');

/** Map of fleet device id (bare) or browser id → room, from the registry. */
export function fetchScreenRooms({ api = DaylightAPI, now = () => Date.now() } = {}) {
  if (cache && now() - cache.at < CACHE_MS) return cache.promise;
  const promise = Promise.resolve()
    .then(() => api('api/v1/media/screens'))
    .then((body) => {
      const rooms = new Map();
      for (const screen of Array.isArray(body?.screens) ? body.screens : []) {
        const room = typeof screen?.room === 'string' ? screen.room.trim() : '';
        if (!room) continue;
        rooms.set(bareId(screen.id), room);
        if (screen.screenId) rooms.set(String(screen.screenId), room);
        for (const alias of Array.isArray(screen.aliases) ? screen.aliases : []) rooms.set(bareId(alias), room);
      }
      const adjacency = new Map();
      for (const [room, list] of Object.entries(body?.roomAdjacency && typeof body.roomAdjacency === 'object' ? body.roomAdjacency : {})) {
        const set = adjacency.get(room.trim().toLowerCase()) ?? new Set();
        for (const other of Array.isArray(list) ? list : []) set.add(String(other).trim().toLowerCase());
        adjacency.set(room.trim().toLowerCase(), set);
      }
      rooms.adjacency = adjacency;
      return rooms;
    })
    .catch((error) => {
      mediaLog.aimDriftWarned({ state: 'registry-unreadable', error: error?.message ?? String(error) });
      cache = null;
      return new Map();
    });
  cache = { at: now(), promise };
  return promise;
}

export function resetScreenRoomsCache() { cache = null; }

export function useScreenRooms(active = true) {
  const [rooms, setRooms] = useState(() => new Map());
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    fetchScreenRooms().then((next) => { if (!cancelled) setRooms(next); });
    return () => { cancelled = true; };
  }, [active]);
  return rooms;
}

const norm = (room) => String(room ?? '').trim().toLowerCase();

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
