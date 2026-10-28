import { describe, it, expect } from 'vitest';
import { BROWSE_MODES, groupEntities, filterEntities } from './groupEntities.js';
import {
  displayName, formatEntityState, formatAge, formatSince, formatWatts, formatKwh, formatDegrees,
} from './formatEntityState.js';

const e = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: over.name || id, state: 'off', stateClass: 'off', type: 'light', room: null, ...over,
});

const entities = [
  e('light.kitchen', { name: 'Kitchen', state: 'on', stateClass: 'on', room: { id: 'kitchen', name: 'Kitchen' } }),
  e('light.office', { name: 'Office', room: { id: 'office', name: 'Office' } }),
  e('sensor.temp', { name: 'Temp', type: 'climate', stateClass: 'reading', state: '71' }),
  e('switch.plug', { name: 'Plug', type: 'power', stateClass: 'unavailable', state: 'unavailable', room: { id: 'office', name: 'Office' } }),
];
const meta = {
  rooms: [{ id: 'office', name: 'Office' }, { id: 'kitchen', name: 'Kitchen' }],
  types: [{ id: 'light', label: 'Lights' }, { id: 'power', label: 'Power' }, { id: 'climate', label: 'Climate' }],
  stateClasses: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }, { id: 'reading', label: 'Readings' }, { id: 'unavailable', label: 'Unavailable' }],
};
const shape = (groups) => groups.map((g) => [g.id, g.entities.map((x) => x.id)]);

describe('groupEntities', () => {
  it('offers type, room and state as grouping modes', () => {
    expect(BROWSE_MODES.map((m) => m.id)).toEqual(['type', 'room', 'state']);
  });

  it('groups by type in the server type order, counting what is on', () => {
    const groups = groupEntities(entities, 'type', meta);
    expect(shape(groups)).toEqual([
      ['light', ['light.kitchen', 'light.office']],
      ['power', ['switch.plug']],
      ['climate', ['sensor.temp']],
    ]);
    expect(groups[0]).toMatchObject({ label: 'Lights', onCount: 1 });
  });

  it('groups by room in room order with a trailing "No room" group', () => {
    expect(shape(groupEntities(entities, 'room', meta))).toEqual([
      ['office', ['light.office', 'switch.plug']],
      ['kitchen', ['light.kitchen']],
      ['__none__', ['sensor.temp']],
    ]);
  });

  it('groups by state class and drops empty groups', () => {
    expect(shape(groupEntities(entities, 'state', meta)).map(([id]) => id)).toEqual(['on', 'off', 'reading', 'unavailable']);
    expect(groupEntities([entities[0]], 'state', meta).map((g) => g.id)).toEqual(['on']);
  });

  it('keeps an entity whose group the metadata does not know', () => {
    const groups = groupEntities([e('vacuum.robo', { type: 'cleaning' })], 'type', meta);
    expect(shape(groups)).toEqual([['cleaning', ['vacuum.robo']]]);
  });
});

describe('filterEntities', () => {
  it('matches name, id or room, case-insensitively', () => {
    expect(filterEntities(entities, { query: 'KITCH' }).map((x) => x.id)).toEqual(['light.kitchen']);
    expect(filterEntities(entities, { query: 'office' }).map((x) => x.id)).toEqual(['light.office', 'switch.plug']);
    expect(filterEntities(entities, { query: 'sensor.' }).map((x) => x.id)).toEqual(['sensor.temp']);
  });

  it('can hide unavailable entities', () => {
    expect(filterEntities(entities, { hideUnavailable: true }).map((x) => x.id)).not.toContain('switch.plug');
  });
});

describe('formatEntityState', () => {
  it.each([
    [{ domain: 'light', state: 'on', stateClass: 'on', detail: { brightnessPct: 50 } }, '50%'],
    [{ domain: 'light', state: 'on', stateClass: 'on', detail: {} }, 'On'],
    [{ domain: 'switch', state: 'off', stateClass: 'off' }, 'Off'],
    [{ domain: 'binary_sensor', state: 'on', stateClass: 'on', deviceClass: 'motion' }, 'Motion'],
    [{ domain: 'binary_sensor', state: 'off', stateClass: 'off', deviceClass: 'door' }, 'Closed'],
    [{ domain: 'sensor', state: '71.4567', stateClass: 'reading', unit: '°F' }, '71.5 °F'],
    [{ domain: 'sensor', state: '1234.5', stateClass: 'reading', unit: 'W' }, '1,235 W'],
    [{ domain: 'sensor', state: 'Window/door is open', stateClass: 'reading' }, 'Window/door is open'],
    [{ domain: 'climate', state: 'heat', stateClass: 'on', detail: { currentTemperature: 68.2, hvacAction: 'heating' } }, '68.2°, heating'],
    [{ domain: 'climate', state: 'heat_cool', stateClass: 'on', detail: {} }, 'Heat cool'],
    [{ domain: 'media_player', state: 'playing', stateClass: 'on', detail: { mediaTitle: 'Song' } }, 'Playing: Song'],
    [{ domain: 'cover', state: 'open', stateClass: 'on' }, 'Open'],
    [{ domain: 'light', state: 'unavailable', stateClass: 'unavailable' }, 'Unavailable'],
    [{ domain: 'sensor', state: '', stateClass: 'reading', unit: 'W' }, ''],
  ])('%j → %s', (entity, expected) => {
    expect(formatEntityState(entity)).toBe(expected);
  });
});

describe('figures', () => {
  it('says watts below a kilowatt and kilowatts above', () => {
    expect(formatWatts(505.4)).toBe('505 W');
    expect(formatWatts(1691.5)).toBe('1.7 kW');
    expect(formatWatts(NaN)).toBeNull();
  });
  it('says kilowatt-hours with one decimal until a hundred', () => {
    expect(formatKwh(0.157)).toBe('0.2 kWh');
    expect(formatKwh(40.03)).toBe('40.0 kWh');
    expect(formatKwh(850.6)).toBe('851 kWh');
  });
  it('rounds degrees to the whole number a glance reads', () => {
    expect(formatDegrees('79.286')).toBe('79°');
    expect(formatDegrees('x')).toBeNull();
  });
});

describe('displayName', () => {
  it('names an opening after its room when the platform named it after its state', () => {
    expect(displayName(e('binary_sensor.office_door', { name: 'Open', type: 'openings', deviceClass: 'door', room: { id: 'office', name: 'Office' } }))).toBe('Office door');
    expect(displayName(e('binary_sensor.w', { name: 'Closed', type: 'openings', deviceClass: 'window', room: null }))).toBe('Window');
    expect(displayName(e('cover.blinds', { name: 'Open', type: 'openings', deviceClass: 'shade', room: { id: 'office', name: 'Office' } }))).toBe('Office blinds');
  });
  it('leaves real names alone', () => {
    expect(displayName(e('binary_sensor.g', { name: 'Garage Door Exterior', type: 'openings', deviceClass: 'door' }))).toBe('Garage Door Exterior');
    expect(displayName(e('switch.x', { name: 'Open', type: 'switch' }))).toBe('Open');
  });
});

describe('formatAge', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  it.each([
    ['2026-10-27T11:59:30Z', '<1m ago'], ['2026-10-27T11:55:00Z', '5m ago'],
    ['2026-10-27T09:00:00Z', '3h ago'], ['2026-10-20T12:00:00Z', '7d ago'], ['nope', null],
  ])('%s → %s', (iso, expected) => {
    expect(formatAge(iso, now)).toBe(expected);
  });
  it('spells the age out for prose, the figure bound to its noun', () => {
    const words = (iso) => formatAge(iso, now, { words: true });
    expect(words('2026-10-27T11:59:30Z')).toBe('under a minute ago');
    expect(words('2026-10-27T11:59:00Z')).toBe('1\u00a0minute ago');
    expect(words('2026-10-27T11:55:00Z')).toBe('5\u00a0minutes ago');
    expect(words('2026-10-27T09:00:00Z')).toBe('3\u00a0hours ago');
  });
});

describe('formatSince', () => {
  const now = Date.parse('2026-10-27T23:30:00');
  it('says a time today, "yesterday" with a time, or a date', () => {
    expect(formatSince('2026-10-27T20:29:00', now)).toMatch(/^8:29 pm$/);
    expect(formatSince('2026-10-26T20:29:00', now)).toMatch(/^yesterday 8:29 pm$/);
    expect(formatSince('2026-10-20T20:29:00', now)).toMatch(/^Oct 20$/);
    expect(formatSince('nope', now)).toBeNull();
  });
});
