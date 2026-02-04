// tests/live/adapter/harvesters/weather.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Weather Harvester Live', () => {
  it('harvests current weather', async () => {
    const result = await runHarvest('weather');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
