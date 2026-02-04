// tests/live/adapter/harvesters/letterboxd.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Letterboxd Harvester Live', () => {
  it('harvests movie diary', async () => {
    const result = await runHarvest('letterboxd');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
