// tests/live/adapter/harvesters/strava.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Strava Harvester Live', () => {
  it('harvests recent activities', async () => {
    const result = await runHarvest('strava');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('strava', { since: daysAgo(30) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 120000);
});
