// tests/live/adapter/harvesters/buxfer.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Buxfer Harvester Live', () => {
  it('harvests recent transactions', async () => {
    const result = await runHarvest('buxfer');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('buxfer', { since: daysAgo(30) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 90000);
});
