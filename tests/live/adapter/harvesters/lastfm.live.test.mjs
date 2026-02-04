// tests/live/adapter/harvesters/lastfm.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Last.fm Harvester Live', () => {
  it('harvests recent scrobbles', async () => {
    const result = await runHarvest('lastfm');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('lastfm', { since: daysAgo(7) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 90000);
});
