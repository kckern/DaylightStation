// tests/live/adapter/harvesters/shopping.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Shopping Harvester Live', () => {
  it('harvests receipt emails', async () => {
    const result = await runHarvest('shopping');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 120000);
});
