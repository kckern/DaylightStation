// tests/isolated/adapter/fitness/GarageFanAdapter.test.mjs
import { vi } from 'vitest';
import { GarageFanAdapter } from '#adapters/fitness/GarageFanAdapter.mjs';

const fanCfg = () => ({
  equipment: [
    {
      name: 'NiceDay', id: 'niceday', type: 'stationary_bike', cadence: 7138,
      fan: { plug_entity: 'garage_fan_plug_temp', temp_entity: 'garage_temp_temperature', min_temp: 65, min_rpm: 30, min_hr_zone: 'warm' }
    },
    { name: 'NoFan', id: 'nofan', cadence: 999 }
  ]
});

const ALL_GO = {
  rpm: { '7138': 72 },
  zones: [{ zoneId: 'warm', isActive: true }],
  sessionEnded: false,
  householdId: 'test'
};

describe('GarageFanAdapter', () => {
  let gateway, loadFitnessConfig, adapter;
  beforeEach(() => {
    gateway = {
      getState: vi.fn().mockResolvedValue({ state: '70' }),
      callService: vi.fn().mockResolvedValue({ ok: true })
    };
    loadFitnessConfig = vi.fn().mockReturnValue(fanCfg());
    adapter = new GarageFanAdapter({ gateway, loadFitnessConfig, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  });

  test('constructor throws without gateway', () => {
    expect(() => new GarageFanAdapter({ loadFitnessConfig })).toThrow('requires gateway');
  });

  test('fires switch.turn_on when all conditions are met', async () => {
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).toHaveBeenCalledWith('switch', 'turn_on', { entity_id: 'switch.garage_fan_plug_temp' });
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ activated: true });
  });

  test('reads garage temp from the normalized sensor entity', async () => {
    await adapter.evaluate(ALL_GO);
    expect(gateway.getState).toHaveBeenCalledWith('sensor.garage_temp_temperature');
  });

  test('does NOT fire when rpm below min_rpm', async () => {
    const r = await adapter.evaluate({ ...ALL_GO, rpm: { '7138': 10 } });
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'rpm_below' });
  });

  test('does NOT fire when no active participant in warm+', async () => {
    const r = await adapter.evaluate({ ...ALL_GO, zones: [{ zoneId: 'active', isActive: true }] });
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'zone_below' });
  });

  test('hot rider satisfies min_hr_zone warm', async () => {
    await adapter.evaluate({ ...ALL_GO, zones: [{ zoneId: 'hot', isActive: true }] });
    expect(gateway.callService).toHaveBeenCalledTimes(1);
  });

  test('does NOT fire when temp at/below min_temp', async () => {
    gateway.getState.mockResolvedValue({ state: '65' });
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'temp_below' });
  });

  test('fails closed when temp sensor unavailable', async () => {
    gateway.getState.mockResolvedValue(null);
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'temp_unavailable' });
  });

  test('latches: fires once, then skips on subsequent evaluate', async () => {
    await adapter.evaluate(ALL_GO);
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).toHaveBeenCalledTimes(1);
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'latched' });
  });

  test('sessionEnded re-arms the latch', async () => {
    await adapter.evaluate(ALL_GO);
    await adapter.evaluate({ ...ALL_GO, sessionEnded: true });
    await adapter.evaluate(ALL_GO);
    expect(gateway.callService).toHaveBeenCalledTimes(2);
  });

  test('skips entirely when no equipment has a fan block', async () => {
    loadFitnessConfig.mockReturnValue({ equipment: [{ id: 'x', cadence: 1 }] });
    const r = await adapter.evaluate(ALL_GO);
    expect(r).toMatchObject({ skipped: true, reason: 'no_fan_config' });
  });
});
