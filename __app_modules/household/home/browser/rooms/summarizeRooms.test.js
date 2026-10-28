import { describe, it, expect } from 'vitest';
import { summarizeRooms, litLightsIn } from './summarizeRooms.js';

const NOW = Date.parse('2026-10-27T23:00:00Z');
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const office = { id: 'office', name: 'Office' };
const e = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: over.name || id, state: 'off', stateClass: 'off', type: 'switch',
  unit: null, deviceClass: null, lastChanged: null, room: office, detail: {}, controllable: false, ...over,
});

const entities = [
  e('light.desk', { name: 'Desk', type: 'light', state: 'on', stateClass: 'on', controllable: true }),
  e('light.ceiling', { name: 'Ceiling', type: 'light', controllable: true }),
  e('light.dead', { name: 'Dead', type: 'light', state: 'unavailable', stateClass: 'unavailable' }),
  e('switch.tv_plug', { name: 'TV plug', type: 'power', state: 'on', stateClass: 'on' }),
  e('binary_sensor.door', { name: 'Door', type: 'openings', deviceClass: 'door' }),
  e('input_boolean.flag', { name: 'Flag', type: 'switch', state: 'on', stateClass: 'on' }),
  e('sensor.temp', { name: 'Temp', type: 'climate', domain: 'sensor', deviceClass: 'temperature', stateClass: 'reading', state: '78.5' }),
  e('sensor.battery', { name: 'Battery', type: 'battery', stateClass: 'reading', state: '46' }),
  e('binary_sensor.presence', { name: 'Presence', type: 'presence', lastChanged: ago(17) }),
  e('light.hall', { name: 'Hall', type: 'light', room: null, state: 'on', stateClass: 'on', controllable: true }),
];

describe('summarizeRooms', () => {
  const [room, elsewhere] = summarizeRooms(entities, [office]);

  it('puts lights first (lit ones on top), then devices, and everything else behind "more"', () => {
    expect(room.lights.map((x) => x.id)).toEqual(['light.desk', 'light.ceiling', 'light.dead']);
    expect(room.devices.map((x) => x.id)).toEqual(['switch.tv_plug', 'binary_sensor.door']);
    expect(room.more.map((x) => x.id)).toEqual(['sensor.battery', 'input_boolean.flag', 'binary_sensor.presence', 'sensor.temp']);
  });

  it('reads the room at a glance', () => {
    expect(room).toMatchObject({ id: 'office', name: 'Office', lightsOn: 1, devicesOn: 1, unavailable: 1, total: 9, humidity: null });
    expect(room.temperature).toMatchObject({ value: 78.5 });
    expect(room.motion).toEqual({ now: false, at: ago(17) });
  });

  it('collects roomless entities as "Elsewhere", last', () => {
    expect(elsewhere).toMatchObject({ id: '__none__', name: 'Elsewhere', lightsOn: 1, total: 1, temperature: null, motion: null });
  });

  it('finds the lit, controllable lights of a room for a room-level off', () => {
    expect(litLightsIn(entities, 'office').map((x) => x.id)).toEqual(['light.desk']);
    expect(litLightsIn(entities, '__none__').map((x) => x.id)).toEqual(['light.hall']);
  });
});
