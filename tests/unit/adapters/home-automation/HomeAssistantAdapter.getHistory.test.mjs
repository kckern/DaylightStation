import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantAdapter } from '#adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';

const sinceIso = '2026-04-20T00:00:00.000Z';

function makeAdapter(mockData) {
  const httpClient = {
    get: vi.fn().mockResolvedValue({ data: mockData }),
    post: vi.fn(),
  };
  const adapter = new HomeAssistantAdapter(
    { baseUrl: 'http://ha', token: 'tok' },
    { httpClient }
  );
  return { adapter, httpClient };
}

describe('HomeAssistantAdapter.getHistory', () => {
  it('returns a Map of entityId → series of { t, v }', async () => {
    const { adapter } = makeAdapter([
      [
        { entity_id: 'sensor.a', state: '70', last_changed: '2026-04-20T01:00:00Z' },
        { entity_id: 'sensor.a', state: '71', last_changed: '2026-04-20T02:00:00Z' },
      ],
      [
        { entity_id: 'sensor.b', state: '50', last_changed: '2026-04-20T01:00:00Z' },
      ],
    ]);

    const result = await adapter.getHistory(['sensor.a', 'sensor.b'], { sinceIso });

    expect(result).toBeInstanceOf(Map);
    expect(result.get('sensor.a')).toEqual([
      { t: '2026-04-20T01:00:00Z', v: 70 },
      { t: '2026-04-20T02:00:00Z', v: 71 },
    ]);
    expect(result.get('sensor.b')).toEqual([
      { t: '2026-04-20T01:00:00Z', v: 50 },
    ]);
  });

  it('caches identical calls within 60s', async () => {
    const { adapter, httpClient } = makeAdapter([[]]);
    await adapter.getHistory(['sensor.a'], { sinceIso });
    await adapter.getHistory(['sensor.a'], { sinceIso });
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('keeps string state when not numeric', async () => {
    const { adapter } = makeAdapter([[
      { entity_id: 'sensor.mode', state: 'auto', last_changed: '2026-04-20T01:00:00Z' },
    ]]);
    const result = await adapter.getHistory(['sensor.mode'], { sinceIso });
    expect(result.get('sensor.mode')).toEqual([
      { t: '2026-04-20T01:00:00Z', v: 'auto' },
    ]);
  });

  it('returns empty Map for empty entityIds', async () => {
    const { adapter, httpClient } = makeAdapter([]);
    const result = await adapter.getHistory([], { sinceIso });
    expect(result.size).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled();
  });
});
