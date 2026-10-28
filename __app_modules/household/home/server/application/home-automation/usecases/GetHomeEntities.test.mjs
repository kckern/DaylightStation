import { describe, it, expect, vi } from 'vitest';
import { GetHomeEntities } from './GetHomeEntities.mjs';

const readings = [
  { entityId: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen' } },
  { entityId: 'switch.office_tv_plug', state: 'off', attributes: { friendly_name: 'Office TV Plug' } },
  { entityId: 'sensor.office_temperature', state: '71.4', attributes: { friendly_name: 'Office Temp', device_class: 'temperature', unit_of_measurement: '°F' } },
  { entityId: 'sensor.plug_voltage', state: '120', attributes: { device_class: 'voltage' } },
  { entityId: 'automation.morning', state: 'on', attributes: {} },
  { entityId: 'binary_sensor.hall_motion', state: 'unavailable', attributes: { device_class: 'motion', friendly_name: 'Hall Motion' } },
];
const rooms = { rooms: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'office', name: 'Office' }, { id: 'garage', name: 'Garage' }], assignments: { 'light.kitchen': 'kitchen' } };

function makeUC({ config = {}, catalog = {} } = {}) {
  return new GetHomeEntities({
    configRepository: { load: async () => config },
    entityCatalog: {
      listReadings: catalog.listReadings || (async () => readings),
      listRooms: catalog.listRooms || (async () => rooms),
    },
    logger: { debug: vi.fn(), warn: vi.fn() },
  });
}

describe('GetHomeEntities', () => {
  it('admits, types, rooms and state-classes entities under the default policy', async () => {
    const result = await makeUC().execute();
    const byId = Object.fromEntries(result.entities.map((e) => [e.id, e]));

    expect(Object.keys(byId).sort()).toEqual(['binary_sensor.hall_motion', 'light.kitchen', 'sensor.office_temperature', 'switch.office_tv_plug']);
    expect(byId['light.kitchen']).toMatchObject({ type: 'light', stateClass: 'on', room: { id: 'kitchen', source: 'provider' }, controllable: true });
    expect(byId['switch.office_tv_plug']).toMatchObject({ type: 'power', room: { id: 'office', name: 'Office', source: 'inferred' }, controllable: false });
    expect(byId['sensor.office_temperature']).toMatchObject({ type: 'climate', stateClass: 'reading', unit: '°F' });
    expect(byId['binary_sensor.hall_motion']).toMatchObject({ type: 'presence', stateClass: 'unavailable', room: null });
  });

  it('lists only the rooms and types that hold something, in platform order', async () => {
    const result = await makeUC().execute();
    expect(result.rooms).toEqual([{ id: 'kitchen', name: 'Kitchen' }, { id: 'office', name: 'Office' }]);
    expect(result.types.map((t) => t.id)).toEqual(['light', 'power', 'climate', 'presence']);
    expect(result.stateClasses.map((s) => s.id)).toEqual(['on', 'off', 'reading', 'unavailable']);
    expect(result.haUrl).toBeNull();
  });

  it('sorts entities by name', async () => {
    const result = await makeUC().execute();
    expect(result.entities.map((e) => e.name)).toEqual(['Hall Motion', 'Kitchen', 'Office Temp', 'Office TV Plug']);
  });

  it('applies the household config: names, room overrides, inference off, HA link', async () => {
    const result = await makeUC({ config: { entities: {
      ha_url: 'https://ha.example',
      infer_rooms: false,
      names: { 'light.kitchen': 'Kitchen ceiling' },
      rooms: { 'binary_sensor.hall_motion': 'garage' },
    } } }).execute();
    const byId = Object.fromEntries(result.entities.map((e) => [e.id, e]));
    expect(byId['light.kitchen'].name).toBe('Kitchen ceiling');
    expect(byId['binary_sensor.hall_motion'].room).toEqual({ id: 'garage', name: 'Garage', source: 'config' });
    expect(byId['switch.office_tv_plug'].room).toBeNull();
    expect(result.haUrl).toBe('https://ha.example');
  });

  it('still lists entities when room data fails', async () => {
    const result = await makeUC({ catalog: { listRooms: async () => { throw new Error('template refused'); } } }).execute();
    expect(result.entities).toHaveLength(4);
    expect(result.rooms.map((r) => r.id)).toEqual([]);
  });

  it('surfaces an unreachable platform', async () => {
    const down = Object.assign(new Error('Home Assistant returned no entities'), { code: 'HOME_PLATFORM_UNREACHABLE' });
    await expect(makeUC({ catalog: { listReadings: async () => { throw down; } } }).execute()).rejects.toBe(down);
  });

  it('reports a malformed config section as a configuration error', async () => {
    await expect(makeUC({ config: { entities: { exclude: 'switch.*' } } }).execute())
      .rejects.toMatchObject({ name: 'ConfigurationError', key: 'entities.exclude' });
  });
});
