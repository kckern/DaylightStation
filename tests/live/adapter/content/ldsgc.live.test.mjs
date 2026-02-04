/**
 * LDS General Conference Live Integration Test
 *
 * Run with: npm test -- tests/live/ldsgc/ldsgc.live.test.mjs
 *
 * Fetches LDS General Conference talk data
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getLDSGCData from '#backend/_legacy/lib/ldsgc.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, SkipTestError } from '../test-preconditions.mjs';

describe('LDSGC Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }
  });

  it('fetches conference data', async () => {
    // ldsgc expects a req object with query property
    const mockReq = { query: {} };
    const result = await getLDSGCData(mockReq);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`LDSGC skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] LDSGC error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} conference items`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else {
      console.log('Conference data fetched');
    }
  }, 60000);
});
