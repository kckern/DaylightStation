// tests/live/adapter/harvesters/gmail.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Gmail Harvester Live', () => {
  it('harvests inbox', async () => {
    const result = await runHarvest('gmail');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);
});
