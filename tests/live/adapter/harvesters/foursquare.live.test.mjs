// tests/live/adapter/harvesters/foursquare.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Foursquare Harvester Live', () => {
  it('harvests check-ins', async () => {
    const result = await runHarvest('foursquare');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
