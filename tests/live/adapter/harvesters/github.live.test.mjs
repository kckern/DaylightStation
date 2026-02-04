// tests/live/adapter/harvesters/github.live.test.mjs

import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('GitHub Harvester Live', () => {
  it('harvests recent commits', async () => {
    const result = await runHarvest('github');

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('github', { since: daysAgo(7) });

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 120000);
});
