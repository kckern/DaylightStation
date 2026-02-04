// tests/live/adapter/harvesters/clickup.live.test.mjs

import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('ClickUp Harvester Live', () => {
  it('harvests recent tasks', async () => {
    const result = await runHarvest('clickup');

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('clickup', { since: daysAgo(7) });

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 90000);
});
