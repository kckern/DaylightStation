// tests/live/adapter/harvesters/goodreads.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Goodreads Harvester Live', () => {
  it('harvests reading list', async () => {
    const result = await runHarvest('goodreads');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
