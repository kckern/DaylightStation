import { describe, it, expect } from 'vitest';
import { composeNow, composeSentence, groupByRoom, listWords, othersWord, roomTemperature } from './composeStatus.js';

const plain = (s) => s.replace(/ /g, ' ');
const NOW = Date.parse('2026-10-27T23:00:00Z');
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

const e = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: over.name || id, state: 'off', stateClass: 'off', type: 'switch',
  unit: null, deviceClass: null, lastChanged: null, room: null, detail: {}, controllable: false, ...over,
});
const room = (id, name) => ({ id, name });
const rooms = [room('garage', 'Garage'), room('kitchen', 'Kitchen'), room('office', 'Office')];

describe('composeSentence', () => {
  const office = { room: room('office', 'Office'), domain: 'binary_sensor', deviceClass: 'door' };
  it.each([
    [{ watts: 505, lightsOn: 9, open: [], motionRooms: [] }, ['The house is drawing 505 W, with 9 lights on.']],
    [{ watts: 1691, lightsOn: 1, open: [office], motionRooms: ['Office'] },
      ['The house is drawing 1.7 kW, with 1 light on and a door open in the office.', 'Someone is in the office.']],
    [{ watts: 505, lightsOn: 0, open: [office, office], motionRooms: ['Office', 'Garage'] },
      ['The house is drawing 505 W, with no lights on and 2 doors open.', 'Someone is in the office and the garage.']],
    [{ watts: 505, lightsOn: 2, open: [office, { ...office, deviceClass: 'window' }], motionRooms: ['Office', 'Garage', 'Kitchen'] },
      ['The house is drawing 505 W, with 2 lights on and 2 doors and windows open.', 'Someone is in the office, the garage and 1 other room.']],
    [{ watts: 180, lightsOn: 0, open: [], motionRooms: [] }, ['The house is quiet, drawing 180 W with nothing on.']],
    [{ watts: null, lightsOn: 3, open: [office], motionRooms: [] }, ['3 lights on, a door open in the office.']],
    [{ watts: null, lightsOn: 0, open: [], motionRooms: [] }, ['All quiet. Nothing is on.']],
  ])('%j', (input, expected) => {
    expect(composeSentence(input).map(plain)).toEqual(expected);
  });

  it('keeps each figure on the same line as its noun', () => {
    const [s] = composeSentence({ watts: 505, lightsOn: 9, open: [], motionRooms: [] });
    expect(s).toContain('505 W');
    expect(s).toContain('9 lights');
  });
});

describe('words', () => {
  it('lists like a person', () => {
    expect(listWords(['a'])).toBe('a');
    expect(listWords(['a', 'b'])).toBe('a and b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
  it('says plugs only when everything else on is a plug', () => {
    expect(othersWord([e('switch.p', { type: 'power' })])).toBe('plugs');
    expect(othersWord([e('switch.p', { type: 'power' }), e('media_player.tv', { type: 'media' })])).toBe('devices');
  });
});

describe('roomTemperature', () => {
  it('prefers a thermostat, then a room sensor, and never a device internal', () => {
    const sensor = e('sensor.office_temp', { type: 'climate', domain: 'sensor', deviceClass: 'temperature', stateClass: 'reading', state: '79.3' });
    const internal = e('sensor.bulb_device_temperature', { type: 'climate', domain: 'sensor', deviceClass: 'temperature', stateClass: 'reading', state: '183' });
    const thermostat = e('climate.t', { type: 'climate', stateClass: 'on', state: 'heat', detail: { currentTemperature: 69 } });
    expect(roomTemperature([internal, sensor])).toMatchObject({ value: 79.3, entityId: 'sensor.office_temp' });
    expect(roomTemperature([sensor, thermostat])).toMatchObject({ value: 69, entityId: 'climate.t' });
    expect(roomTemperature([internal])).toBeNull();
  });
});

describe('composeNow', () => {
  const entities = [
    e('light.garage', { type: 'light', state: 'on', stateClass: 'on', room: rooms[0], controllable: true, detail: { brightnessPct: 100 } }),
    e('light.lamp', { type: 'light', state: 'on', stateClass: 'on', controllable: true }),
    e('switch.tv_plug', { type: 'power', state: 'on', stateClass: 'on', room: rooms[2] }),
    e('binary_sensor.office_door', { name: 'Open', type: 'openings', domain: 'binary_sensor', deviceClass: 'door', state: 'on', stateClass: 'on', room: rooms[2], lastChanged: ago(90) }),
    e('binary_sensor.office_presence', { type: 'presence', state: 'on', stateClass: 'on', room: rooms[2], lastChanged: ago(30) }),
    e('binary_sensor.kitchen_motion', { type: 'presence', room: rooms[1], lastChanged: ago(5) }),
    e('binary_sensor.garage_motion', { type: 'presence', room: rooms[0], lastChanged: ago(2) }),
    e('sensor.remote_battery', { type: 'battery', stateClass: 'reading', state: '9', room: rooms[2] }),
    e('binary_sensor.driveway', { type: 'presence', state: 'unavailable', stateClass: 'unavailable' }),
    e('sensor.kitchen_temp', { type: 'climate', domain: 'sensor', deviceClass: 'temperature', stateClass: 'reading', state: '66.9', room: rooms[1] }),
    e('sensor.kitchen_humidity', { type: 'climate', domain: 'sensor', deviceClass: 'humidity', stateClass: 'reading', state: '53', room: rooms[1] }),
    e('sensor.thermostat_outdoor_temperature', { type: 'climate', domain: 'sensor', deviceClass: 'temperature', stateClass: 'reading', state: '57', room: rooms[1] }),
    e('climate.thermostat', { type: 'climate', stateClass: 'on', state: 'heat_cool', detail: { currentTemperature: 69, hvacAction: 'idle' }, room: rooms[1] }),
  ];
  const summary = {
    power: { wholeHouse: { entityId: 'sensor.panel', watts: 505 }, energyToday: null, energyThisMonth: null, topConsumers: [] },
    on: ['light.garage', 'light.lamp', 'switch.tv_plug'],
    open: ['binary_sensor.office_door'],
    motion: ['binary_sensor.office_presence', 'binary_sensor.kitchen_motion', 'binary_sensor.garage_motion'],
    lowBattery: [{ entityId: 'sensor.remote_battery', pct: 9 }],
    unavailable: ['binary_sensor.driveway'],
    thresholds: { lowBatteryPct: 20, motionWindowMinutes: 15 },
  };
  const now = composeNow({ entities, rooms, summary });

  it('writes the sentence from the summary, rooms with someone in them first', () => {
    expect(now.sentences.map(plain)).toEqual([
      'The house is drawing 505 W, with 2 lights on and a door open in the office.',
      'Someone is in the office, the garage and 1 other room.',
    ]);
  });

  it('groups what is on by room, roomless last, plugs apart from lights', () => {
    expect(now.on.lights.map((r) => [r.id, r.entities.map((x) => x.id)])).toEqual([['garage', ['light.garage']], ['__none__', ['light.lamp']]]);
    expect(now.on.others.map((x) => x.id)).toEqual(['switch.tv_plug']);
    expect(now.counts).toMatchObject({ lightsOn: 2, othersOn: 1, othersWord: 'plugs', open: 1, motionRooms: 3, lowBattery: 1, unavailable: 1 });
  });

  it('labels an opening by its room when its name is just its state', () => {
    expect(now.open[0].label).toBe('Office door');
  });

  it('orders motion rooms: present now first, then most recently seen', () => {
    expect(now.motion.map((r) => [r.name, r.motion.now])).toEqual([['Office', true], ['Garage', false], ['Kitchen', false]]);
  });

  it('gives each room one temperature, its humidity, and the outdoor reading apart', () => {
    expect(now.climate).toEqual([{ id: 'kitchen', name: 'Kitchen', temperature: expect.objectContaining({ value: 69, entityId: 'climate.thermostat' }), humidity: 53 }]);
    expect(now.outdoor).toBe(57);
  });

  it('carries low batteries with their percentage and the silent ones', () => {
    expect(now.attention.lowBattery).toEqual([expect.objectContaining({ id: 'sensor.remote_battery', pct: 9 })]);
    expect(now.attention.unavailable.map((x) => x.id)).toEqual(['binary_sensor.driveway']);
  });

  it('degrades to an empty report without a summary', () => {
    const bare = composeNow({ entities, rooms, summary: null });
    expect(bare.sentences).toEqual(['All quiet. Nothing is on.']);
    expect(bare.counts.lightsOn).toBe(0);
    expect(bare.climate).toHaveLength(1);
  });

  it('groups by room in the house order', () => {
    expect(groupByRoom(entities.slice(0, 3), rooms).map((r) => r.id)).toEqual(['garage', 'office', '__none__']);
  });
});
