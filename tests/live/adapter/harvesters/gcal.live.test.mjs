// tests/live/adapter/harvesters/gcal.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Google Calendar Harvester Live', () => {
  it('harvests calendar events', async () => {
    const result = await runHarvest('gcal');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('gcal', { since: daysAgo(14) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 120000);
});
