// PLACE.4a/AC6 (RQ-PLACE-10): screens chosen together in the same room warn
// that drift may be audible; rooms come from the screen registry (§2.5).
import { describe, it, expect } from 'vitest';
import { screenRoomsFromRegistry, sharedRoomGroups, neighbouringRoomGroups, driftWarningText } from "./screenRooms.js";

const registry = {
  screens: [
    { id: 'fleet:speaker-blue', screenId: 'speaker-blue', room: "Kids' Rooms", aliases: [] },
    { id: 'fleet:speaker-red', screenId: 'speaker-red', room: "Kids' Rooms", aliases: [] },
    { id: 'fleet:livingroom-tv', screenId: 'legacy-tv', room: ' Living Room ', aliases: ['browser:abc', 'fleet:old-tv'] },
  ],
  notSeenLately: [{ id: 'browser:offline', room: 'Living Room' }],
  retired: [{ id: 'browser:retired', room: 'Living Room' }],
  unnamed: [{ id: 'browser:unnamed', room: 'Living Room' }],
};
const devices = [
  { id: 'speaker-blue', name: 'Blue speaker' },
  { id: 'speaker-red', name: 'Red speaker' },
  { id: 'livingroom-tv', name: 'Living Room TV' },
  { id: 'office-tv', name: 'Office TV', location: 'Office' },
];

describe('screen rooms and the drift warning', () => {
  it('projects rooms from active registry screens, keyed by device id, screen id and alias', () => {
    const rooms = screenRoomsFromRegistry(registry);
    expect(rooms.get('speaker-blue')).toBe("Kids' Rooms");
    expect(rooms.get('livingroom-tv')).toBe('Living Room');
    expect(rooms.get('legacy-tv')).toBe('Living Room');
    expect(rooms.get('browser:abc')).toBe('Living Room');
    expect(rooms.get('old-tv')).toBe('Living Room');
    expect(rooms.has('browser:offline')).toBe(false);
    expect(rooms.has('browser:retired')).toBe(false);
    expect(rooms.has('browser:unnamed')).toBe(false);
  });

  it('warns for screens that share a room, naming them', () => {
    const rooms = screenRoomsFromRegistry(registry);
    const groups = sharedRoomGroups(['speaker-blue', 'speaker-red', 'livingroom-tv'], devices, rooms);
    expect(groups).toEqual([{ room: "Kids' Rooms", names: ['Blue speaker', 'Red speaker'] }]);
    expect(driftWarningText(groups)).toBe("Blue speaker and Red speaker are both in Kids' Rooms — they start together but can drift apart, and you may hear it.");
  });

  it('falls back to configured rooms when the registry has no room for a device', () => {
    const rooms = screenRoomsFromRegistry();
    const officeDevices = [...devices, { id: 'office-speaker', name: 'Office speaker', location: ' office ' }];
    expect(sharedRoomGroups(['office-tv', 'office-speaker'], officeDevices, rooms)).toEqual([
      { room: 'Office', names: ['Office TV', 'Office speaker'] },
    ]);
    expect(driftWarningText([])).toBeNull();
  });

  it('warns for screens in neighbouring rooms using trimmed, case-insensitive adjacency', () => {
    const rooms = screenRoomsFromRegistry({ ...registry, roomAdjacency: { ' living Room ': [" kids' ROOMS "] } });
    const near = neighbouringRoomGroups(['speaker-blue', 'livingroom-tv'], devices, rooms);
    expect(near).toEqual([{ rooms: ["Kids' Rooms", 'Living Room'], names: ['Blue speaker', 'Living Room TV'] }]);
    expect(driftWarningText([], near)).toBe("Blue speaker and Living Room TV are in neighbouring rooms (Kids' Rooms and Living Room) — they start together but can drift apart, and you may hear it.");
    // Office is not next to anything; two screens in one room are the shared-room case, not this one.
    expect(neighbouringRoomGroups(['livingroom-tv', 'office-tv'], devices, rooms)).toEqual([]);
    expect(neighbouringRoomGroups(['speaker-blue', 'speaker-red'], devices, rooms)).toEqual([]);
  });

  it('records no neighbours when the registry has no adjacency', () => {
    const rooms = screenRoomsFromRegistry(registry);
    expect(neighbouringRoomGroups(['speaker-blue', 'livingroom-tv'], devices, rooms)).toEqual([]);
  });
});
