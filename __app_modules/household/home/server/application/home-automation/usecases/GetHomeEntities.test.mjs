import { describe, it, expect, vi } from 'vitest';
import { GetHomeEntities } from './GetHomeEntities.mjs';

const r = (entityId, state, over = {}) => ({ entityId, state, name: null, deviceClass: null, unit: null, lastChanged: null, detail: {}, ...over });
const readings = [
  r('light.kitchen', 'on', { name: 'Kitchen' }),
  r('sensor.panel_total_power', '505.4', { name: 'Panel', deviceClass: 'power', unit: 'W' }),
  r('sensor.panel_total_energy_today', '40', { name: 'Panel today', deviceClass: 'energy', unit: 'kWh' }),
  r('sensor.office_power', '302', { name: 'Office circuit', deviceClass: 'power', unit: 'W' }),
  r('sensor.remote_battery', '9', { name: 'Remote battery', deviceClass: 'battery', unit: '%' }),
  r('switch.office_tv_plug', 'off', { name: 'Office TV Plug' }),
  r('sensor.office_temperature', '71.4', { name: 'Office Temp', deviceClass: 'temperature', unit: '°F' }),
  r('sensor.plug_voltage', '120', { deviceClass: 'voltage' }),
  r('automation.morning', 'on'),
  r('binary_sensor.hall_motion', 'unavailable', { deviceClass: 'motion', name: 'Hall Motion' }),
];
const rooms = { rooms: [{ id: 'office', name: 'Office' }, { id: 'kitchen', name: 'Kitchen' }, { id: 'garage', name: 'Garage' }], assignments: { 'light.kitchen': 'kitchen' } };

function makeUC({ config = {}, catalog = {} } = {}) {
  return new GetHomeEntities({
    configRepository: { load: async () => config },
    clock: () => Date.parse('2026-10-27T23:00:00Z'),
    entityGateway: {
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

    expect(Object.keys(byId).sort()).toEqual([
      'binary_sensor.hall_motion', 'light.kitchen', 'sensor.office_power', 'sensor.office_temperature',
      'sensor.panel_total_energy_today', 'sensor.panel_total_power', 'sensor.remote_battery', 'switch.office_tv_plug',
    ]);
    expect(byId['light.kitchen']).toMatchObject({ type: 'light', stateClass: 'on', room: { id: 'kitchen', source: 'provider' }, controllable: true });
    expect(byId['switch.office_tv_plug']).toMatchObject({ type: 'power', room: { id: 'office', name: 'Office', source: 'inferred' }, controllable: false });
    expect(byId['sensor.office_temperature']).toMatchObject({ type: 'climate', stateClass: 'reading', unit: '°F' });
    expect(byId['binary_sensor.hall_motion']).toMatchObject({ type: 'presence', stateClass: 'unavailable', room: null });
  });

  it('lists only the rooms and types that hold something, rooms alphabetically', async () => {
    const result = await makeUC().execute();
    expect(result.rooms).toEqual([{ id: 'kitchen', name: 'Kitchen' }, { id: 'office', name: 'Office' }]);
    expect(result.types.map((t) => t.id)).toEqual(['light', 'power', 'climate', 'presence', 'battery']);
    expect(result.stateClasses.map((s) => s.id)).toEqual(['on', 'off', 'reading', 'unavailable']);
    expect(result.haUrl).toBeNull();
  });

  it('sorts entities by name', async () => {
    const result = await makeUC().execute();
    expect(result.entities.map((e) => e.name)).toEqual([
      'Hall Motion', 'Kitchen', 'Office circuit', 'Office Temp', 'Office TV Plug', 'Panel', 'Panel today', 'Remote battery',
    ]);
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
    expect(result.entities).toHaveLength(8);
    expect(result.rooms.map((r) => r.id)).toEqual([]);
  });

  it('surfaces an unreachable platform', async () => {
    const down = Object.assign(new Error('Home Assistant returned no entities'), { code: 'HOME_PLATFORM_UNREACHABLE' });
    await expect(makeUC({ catalog: { listReadings: async () => { throw down; } } }).execute()).rejects.toBe(down);
  });

  it('does not ask for rooms when the readings fail', async () => {
    const listRooms = vi.fn();
    await expect(makeUC({ catalog: { listReadings: async () => { throw new Error('down'); }, listRooms } }).execute()).rejects.toThrow('down');
    expect(listRooms).not.toHaveBeenCalled();
  });

  it('reports a malformed config section as a configuration error', async () => {
    await expect(makeUC({ config: { entities: { exclude: 'switch.*' } } }).execute())
      .rejects.toMatchObject({ name: 'ConfigurationError', key: 'entities.exclude' });
  });

  it('summarizes the house under the default now/power policy', async () => {
    const { summary } = await makeUC().execute();
    expect(summary.power.wholeHouse).toEqual({ entityId: 'sensor.panel_total_power', watts: 505.4 });
    expect(summary.power.energyToday).toEqual({ entityId: 'sensor.panel_total_energy_today', kwh: 40 });
    expect(summary.power.topConsumers).toEqual([{ entityId: 'sensor.office_power', watts: 302 }]);
    expect(summary.on).toEqual(['light.kitchen']);
    expect(summary.lowBattery).toEqual([{ entityId: 'sensor.remote_battery', pct: 9 }]);
    expect(summary.unavailable).toEqual(['binary_sensor.hall_motion']);
    expect(summary.stuck).toEqual([]);
    expect(summary.thresholds).toEqual({ lowBatteryPct: 20, motionWindowMinutes: 15, motionStaleHours: 24 });
  });

  it('applies the now and power sections of the config', async () => {
    const { summary } = await makeUC({ config: {
      now: { low_battery_pct: 5, ignore: ['light.kitchen'] },
      power: { whole_house: 'sensor.office_power' },
    } }).execute();
    expect(summary.power.wholeHouse).toEqual({ entityId: 'sensor.office_power', watts: 302 });
    expect(summary.power.topConsumers).toEqual([{ entityId: 'sensor.panel_total_power', watts: 505.4 }]);
    expect(summary.on).toEqual([]);
    expect(summary.lowBattery).toEqual([]);
  });

  it('reports a bad now section as a configuration error naming the key', async () => {
    await expect(makeUC({ config: { now: { low_battery_pct: 'low' } } }).execute())
      .rejects.toMatchObject({ name: 'ConfigurationError', key: 'now.low_battery_pct' });
  });

  it('reports a malformed mosaic section as a configuration error with its dotted key', async () => {
    await expect(makeUC({ config: { mosaic: { type_groups: 'battery' } } }).execute())
      .rejects.toMatchObject({ name: 'ConfigurationError', key: expect.stringMatching(/^mosaic\./) });
  });

  it('arranges the mosaic from the mosaic policy', async () => {
    const out = await makeUC({ config: { mosaic: { type_groups: ['battery'] } } }).execute();
    expect(out.mosaic.byRoom.at(-1).id).toBe('_elsewhere');
    expect(out.mosaic.byRoom.some((g) => g.id === 'type:battery')).toBe(true);
    expect(out.mosaic.byType.map((g) => g.id)).toContain('light');
  });
});
