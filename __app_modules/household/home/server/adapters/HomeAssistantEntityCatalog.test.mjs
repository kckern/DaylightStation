import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantEntityCatalog } from './HomeAssistantEntityCatalog.mjs';

const quiet = { debug: vi.fn(), warn: vi.fn() };
const reading = { entityId: 'light.desk', state: 'on', attributes: {}, lastChanged: 't' };

describe('HomeAssistantEntityCatalog', () => {
  it('requires an injected gateway', () => {
    expect(() => new HomeAssistantEntityCatalog({}, {})).toThrow(/requires gateway/);
  });

  it('reads every entity live through the gateway', async () => {
    const gateway = { listAllStates: vi.fn().mockResolvedValue([reading]) };
    const catalog = new HomeAssistantEntityCatalog({}, { gateway, logger: quiet });
    expect(await catalog.listReadings()).toEqual([reading]);
    await catalog.listReadings();
    expect(gateway.listAllStates).toHaveBeenCalledTimes(2);
  });

  it('treats an empty read as an unreachable platform, not an empty house', async () => {
    const gateway = { listAllStates: vi.fn().mockResolvedValue([]) };
    const catalog = new HomeAssistantEntityCatalog({}, { gateway, logger: quiet });
    await expect(catalog.listReadings()).rejects.toMatchObject({ code: 'HOME_PLATFORM_UNREACHABLE' });
  });

  it('caches rooms for the TTL and re-reads after it', async () => {
    let now = 1000;
    const gateway = {
      listAreaAssignments: vi.fn().mockResolvedValue({ areas: [{ id: 'office', name: 'Office' }], assignments: { 'light.desk': 'office' } }),
    };
    const catalog = new HomeAssistantEntityCatalog({ roomsTtlMs: 60_000 }, { gateway, logger: quiet, now: () => now });
    expect(await catalog.listRooms()).toEqual({ rooms: [{ id: 'office', name: 'Office' }], assignments: { 'light.desk': 'office' } });
    now += 59_000;
    await catalog.listRooms();
    expect(gateway.listAreaAssignments).toHaveBeenCalledTimes(1);
    now += 2_000;
    await catalog.listRooms();
    expect(gateway.listAreaAssignments).toHaveBeenCalledTimes(2);
  });

  it('does not cache an empty room answer', async () => {
    const gateway = { listAreaAssignments: vi.fn().mockResolvedValue({ areas: [], assignments: {} }) };
    const catalog = new HomeAssistantEntityCatalog({}, { gateway, logger: quiet });
    await catalog.listRooms();
    await catalog.listRooms();
    expect(gateway.listAreaAssignments).toHaveBeenCalledTimes(2);
  });

  it('has no rooms when the gateway cannot supply them', async () => {
    const catalog = new HomeAssistantEntityCatalog({}, { gateway: {}, logger: quiet });
    expect(await catalog.listRooms()).toEqual({ rooms: [], assignments: {} });
  });
});
