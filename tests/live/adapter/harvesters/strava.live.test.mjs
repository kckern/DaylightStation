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

  it('deep backfills archives to Jan 2024', async () => {
    // Deep backfill: fetches all activities since Jan 2024 and enriches with HR data.
    // Cached archives are reused (no API call). Only missing entries hit Strava API
    // with 5s rate-limit delay between HR stream requests.
    // Timeout: 45 min to handle ~500 activities at 5s/each.
    const result = await runHarvest('strava', {
      since: '2024-01-01',
      timeout: 2700,  // 45 minutes in seconds
    });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 2700000);  // Jest timeout: 45 minutes
});
