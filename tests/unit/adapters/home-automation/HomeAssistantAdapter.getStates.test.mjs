import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantAdapter } from '#adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';

function makeHttpClient(mockData) {
  return {
    get: vi.fn().mockResolvedValue({ data: mockData }),
    post: vi.fn(),
  };
}

describe('HomeAssistantAdapter.getStates', () => {
  it('returns a Map keyed by entityId, filtered to requested ids', async () => {
    const httpClient = makeHttpClient([
      { entity_id: 'light.a', state: 'on',  attributes: {}, last_changed: 't1' },
      { entity_id: 'light.b', state: 'off', attributes: {}, last_changed: 't2' },
      { entity_id: 'sensor.x', state: '71', attributes: { unit_of_measurement: '°F' }, last_changed: 't3' },
    ]);
    const adapter = new HomeAssistantAdapter(
      { baseUrl: 'http://ha', token: 'tok' },
      { httpClient }
    );

    const result = await adapter.getStates(['light.a', 'sensor.x', 'light.missing']);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get('light.a').state).toBe('on');
    expect(result.get('sensor.x').state).toBe('71');
    expect(result.has('light.missing')).toBe(false);
    expect(httpClient.get).toHaveBeenCalledTimes(1); // single batch call
    expect(httpClient.get.mock.calls[0][0]).toContain('/api/states');
  });

  it('returns empty Map when HA returns empty', async () => {
    const adapter = new HomeAssistantAdapter(
      { baseUrl: 'http://ha', token: 'tok' },
      { httpClient: makeHttpClient([]) }
    );
    const result = await adapter.getStates(['light.a']);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when given empty entityIds', async () => {
    const httpClient = makeHttpClient([]);
    const adapter = new HomeAssistantAdapter(
      { baseUrl: 'http://ha', token: 'tok' },
      { httpClient }
    );
    const result = await adapter.getStates([]);
    expect(result.size).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled(); // short-circuit
  });
});
