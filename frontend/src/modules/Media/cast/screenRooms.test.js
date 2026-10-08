// PLACE.4a/AC6 (RQ-PLACE-10): screens chosen together in the same room warn
// that drift may be audible; rooms come from the screen registry (§2.5).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchScreenRooms, resetScreenRoomsCache, sharedRoomGroups, neighbouringRoomGroups, driftWarningText } from './screenRooms.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const registry = { screens: [
  { id: 'fleet:speaker-blue', screenId: 'speaker-blue', room: "Kids' Rooms", aliases: [] },
  { id: 'fleet:speaker-red', screenId: 'speaker-red', room: "Kids' Rooms", aliases: [] },
  { id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', room: 'Living Room', aliases: ['browser:abc'] },
], notSeenLately: [], retired: [] };
const devices = [
  { id: 'speaker-blue', name: 'Blue speaker' },
  { id: 'speaker-red', name: 'Red speaker' },
  { id: 'livingroom-tv', name: 'Living Room TV' },
  { id: 'office-tv', name: 'Office TV', location: 'Office' },
];

beforeEach(() => resetScreenRoomsCache());

describe('screen rooms and the drift warning', () => {
  it('reads rooms from the registry, keyed by device id and alias', async () => {
    const api = vi.fn(async () => registry);
    const rooms = await fetchScreenRooms({ api });
    expect(api).toHaveBeenCalledWith('api/v1/media/screens');
    expect(rooms.get('speaker-blue')).toBe("Kids' Rooms");
    expect(rooms.get('browser:abc')).toBe('Living Room');
  });

  it('warns for screens that share a room, naming them', async () => {
    const rooms = await fetchScreenRooms({ api: async () => registry });
    const groups = sharedRoomGroups(['speaker-blue', 'speaker-red', 'livingroom-tv'], devices, rooms);
    expect(groups).toEqual([{ room: "Kids' Rooms", names: ['Blue speaker', 'Red speaker'] }]);
    expect(driftWarningText(groups)).toBe("Blue speaker and Red speaker are both in Kids' Rooms — they start together but can drift apart, and you may hear it.");
  });

  it('is quiet for screens in different rooms, and survives an unreadable registry', async () => {
    const rooms = await fetchScreenRooms({ api: async () => { throw new Error('501'); } });
    expect(sharedRoomGroups(['livingroom-tv', 'office-tv'], devices, rooms)).toEqual([]);
    expect(driftWarningText([])).toBeNull();
  });

  it('warns for screens in neighbouring rooms, from the registry adjacency, and not for rooms that do not neighbour', async () => {
    const withAdjacency = { ...registry, roomAdjacency: { 'Living Room': ["Kids' Rooms"], "Kids' Rooms": ['Living Room'] } };
    const rooms = await fetchScreenRooms({ api: async () => withAdjacency });
    const near = neighbouringRoomGroups(['speaker-blue', 'livingroom-tv'], devices, rooms);
    expect(near).toEqual([{ rooms: ["Kids' Rooms", 'Living Room'], names: ['Blue speaker', 'Living Room TV'] }]);
    expect(driftWarningText([], near)).toBe("Blue speaker and Living Room TV are in neighbouring rooms (Kids' Rooms and Living Room) — they start together but can drift apart, and you may hear it.");
    // Office is not next to anything; two screens in one room are the shared-room case, not this one.
    expect(neighbouringRoomGroups(['livingroom-tv', 'office-tv'], devices, rooms)).toEqual([]);
    expect(neighbouringRoomGroups(['speaker-blue', 'speaker-red'], devices, rooms)).toEqual([]);
  });

  it('records no neighbours when the registry has no adjacency', async () => {
    const rooms = await fetchScreenRooms({ api: async () => registry });
    expect(neighbouringRoomGroups(['speaker-blue', 'livingroom-tv'], devices, rooms)).toEqual([]);
  });
});
