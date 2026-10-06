// frontend/src/modules/Media/cast/screenRooms.js
// Rooms of the household's screens, from the screen registry
// (GET /api/v1/media/screens, tech doc §2.5), for the several-screen drift
// warning (PLACE.4a/AC6, RQ-PLACE-10): screens started together drift apart,
// and in the same room that drift is audible.
//
// The registry names a room per screen; it records no adjacency, so
// "neighbouring rooms" cannot be known — the warning covers screens that
// share a room. A screen the registry does not know falls back to its
// configured fleet location.
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

export function driftWarningText(groups) {
  if (!groups.length) return null;
  const parts = groups.map(({ room, names }) => `${names.join(' and ')} are ${names.length === 2 ? 'both' : 'all'} in ${room}`);
  return `${parts.join('; ')} — they start together but can drift apart, and you may hear it.`;
}
