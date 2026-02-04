// tests/live/adapter/harvesters/reddit.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Reddit Harvester Live', () => {
  it('harvests recent activity', async () => {
    const result = await runHarvest('reddit');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
