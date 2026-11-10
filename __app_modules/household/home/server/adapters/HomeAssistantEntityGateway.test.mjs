import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantEntityGateway, toEntityReading } from './HomeAssistantEntityGateway.mjs';

const quiet = { debug: vi.fn(), warn: vi.fn() };
const reading = { entityId: 'light.desk', state: 'on', attributes: {}, lastChanged: 't' };

describe('HomeAssistantEntityGateway', () => {
  it('requires an injected gateway', () => {
    expect(() => new HomeAssistantEntityGateway({}, {})).toThrow(/requires gateway/);
  });

  it('reads every entity live through the gateway, normalized', async () => {
    const gateway = { listAllStates: vi.fn().mockResolvedValue([reading]) };
    const catalog = new HomeAssistantEntityGateway({}, { gateway, logger: quiet });
    expect(await catalog.listReadings()).toEqual([toEntityReading(reading)]);
    await catalog.listReadings();
    expect(gateway.listAllStates).toHaveBeenCalledTimes(2);
  });

  it('translates the HA attribute bag into a provider-neutral reading', () => {
    expect(toEntityReading({
      entityId: 'light.desk', state: 'on', lastChanged: 't1',
      attributes: { friendly_name: 'Desk', brightness: 128, icon: 'mdi:lamp', unit_of_measurement: '', device_class: 'x' },
    })).toEqual({
      entityId: 'light.desk', state: 'on', name: 'Desk', deviceClass: 'x', unit: null, lastChanged: 't1',
      detail: { brightnessPct: 50 },
    });
    expect(toEntityReading({
      entityId: 'climate.hall', state: 'heat',
      attributes: { current_temperature: 68.5, temperature: '70', hvac_action: 'heating', percentage: '' },
    }).detail).toEqual({ currentTemperature: 68.5, targetTemperature: 70, hvacAction: 'heating' });
  });

  it('treats an empty read as an unreachable platform, not an empty house', async () => {
    const gateway = { listAllStates: vi.fn().mockResolvedValue([]) };
    const catalog = new HomeAssistantEntityGateway({}, { gateway, logger: quiet });
    await expect(catalog.listReadings()).rejects.toMatchObject({ code: 'HOME_PLATFORM_UNREACHABLE' });
  });

  it('caches rooms for the TTL and re-reads after it', async () => {
    let now = 1000;
    const gateway = {
      listAreaAssignments: vi.fn().mockResolvedValue({ areas: [{ id: 'office', name: 'Office' }], assignments: { 'light.desk': 'office' } }),
    };
    const catalog = new HomeAssistantEntityGateway({ roomsTtlMs: 60_000 }, { gateway, logger: quiet, now: () => now });
    expect(await catalog.listRooms()).toEqual({ rooms: [{ id: 'office', name: 'Office' }], assignments: { 'light.desk': 'office' } });
    now += 59_000;
    await catalog.listRooms();
    expect(gateway.listAreaAssignments).toHaveBeenCalledTimes(1);
    now += 2_000;
    await catalog.listRooms();
    expect(gateway.listAreaAssignments).toHaveBeenCalledTimes(2);
  });

  it('retries an empty room answer after a minute, not on every poll', async () => {
    let now = 0;
    const gateway = { listAreaAssignments: vi.fn().mockResolvedValue({ areas: [], assignments: {} }) };
    const catalog = new HomeAssistantEntityGateway({}, { gateway, logger: quiet, now: () => now });
    await catalog.listRooms();
    now += 10_000;
    await catalog.listRooms();
    expect(gateway.listAreaAssignments).toHaveBeenCalledTimes(1);
    now += 60_000;
    await catalog.listRooms();
    expect(gateway.listAreaAssignments).toHaveBeenCalledTimes(2);
  });

  it('has no rooms when the gateway cannot supply them', async () => {
    const catalog = new HomeAssistantEntityGateway({}, { gateway: {}, logger: quiet });
    expect(await catalog.listRooms()).toEqual({ rooms: [], assignments: {} });
  });
});
