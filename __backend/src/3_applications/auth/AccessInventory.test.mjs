import { describe, expect, it } from 'vitest';
import { AccessInventory } from './AccessInventory.mjs';

const hour = 60 * 60 * 1000;
const window = (sequence, start, end, observations = [], overflow = false) => ({
  writerId: 'boot', sequence, start, end, observations, overflow,
});
const host = (hostname, requests, resolution = 'exact', ingress = 'http') => ({
  host: hostname, requests, resolution, ingress, householdId: 'a',
});
const since = '2026-11-26T00:00:00Z';
const until = '2026-11-26T03:00:00Z';
const start = Date.parse(since);
const end = Date.parse(until);
const stations = ['a', 'b'].map(householdId => ({ householdId, id: 'garage' }));
const known = {
  domainMapping: { 'mapped.example': 'a' },
  devices: [...stations, { householdId: 'a', id: 'inactive' }],
  callers: ['relay', 'bot', 'job'].map(kind => ({ id: kind, kind, transport: kind, provisioningOwner: 'operator' })),
};
const sightings = stations.map(row => ({ ...row, lastSeen: start + hour }));
const inventory = (windows, more = {}) => new AccessInventory({
  observationSource: { read: async () => ({ windows, sightings, callers: [], ...more }) },
  registrationSource: { read: async () => known },
});

describe('AccessInventory', () => {
  it('the report lists an unmapped host and a header-only device', async () => {
    const first = window(1, start, start + hour, [host('mapped.example', 38), host('unmapped.example:8080', 12, 'fallback')]);
    const second = window(2, start + hour, end, [host('mapped.example', 2, 'unresolved-by-router', 'websocket')]);
    const report = await inventory([first, first, second]).report({ since, until });

    expect(report.hosts).toContainEqual(expect.objectContaining({ host: 'unmapped.example:8080', mapped: false, requests: 12 }));
    expect(report.hosts).toContainEqual(expect.objectContaining({ host: 'mapped.example', mapped: true, requests: 38, upgrades: 2 }));
    expect(report.devices.filter(device => device.id === 'garage').map(device => device.householdId)).toEqual(['a', 'b']);
    expect(report.devices).toContainEqual(expect.objectContaining({ id: 'garage', proof: 'declared-header' }));
    expect(report.devices.find(device => device.id === 'inactive').lastSeen).toBeNull();
    expect(report.callers.map(caller => caller.kind)).toEqual(expect.arrayContaining(['relay', 'bot', 'job']));
    expect(report.unknown).toEqual([]);
    expect(report.coverage.complete).toBe(true);
  });

  it('reports gaps, empty sources, overflow and partial boundary windows', async () => {
    const first = window(1, start, start + hour);
    const last = window(3, start + 2 * hour, end);
    const overflow = window(2, start + hour, start + 2 * hour, [], true);
    const partial = { ...window(1, start - hour, start + hour, [host('mapped.example', 4)]), writerId: 'previous-boot' };
    for (const records of [[first, last], [], [first, overflow, last], [partial, last]]) {
      const { coverage } = await inventory(records).report({ since, until });
      expect(coverage.complete).toBe(false);
    }
    const { hosts } = await inventory([partial, last]).report({ since, until });
    expect(hosts).toEqual([]);
  });

  it('rejects malformed or conflicting records, and surfaces unregistered sightings', async () => {
    const first = window(1, start, end);
    await expect(inventory([first, { ...first, overflow: true }]).report({ since, until })).rejects.toThrow(/window/i);
    await expect(inventory([window(1, start, end, [host('mapped.example', -1)])]).report({ since, until })).rejects.toThrow(/count/i);
    const { unknown } = await inventory([first], {
      sightings: [{ householdId: 'b', id: 'unknown', lastSeen: start }],
      callers: [{ householdId: 'b', id: 'unregistered', kind: 'relay', transport: 'mqtt' }],
    }).report({ since, until });
    expect(unknown.map(row => row.id)).toEqual(expect.arrayContaining(['unknown', 'unregistered']));
  });
});
