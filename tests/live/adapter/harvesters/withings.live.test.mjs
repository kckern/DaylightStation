// tests/live/adapter/harvesters/withings.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Withings Harvester Live', () => {
  it('harvests scale measurements', async () => {
    const result = await runHarvest('withings');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
