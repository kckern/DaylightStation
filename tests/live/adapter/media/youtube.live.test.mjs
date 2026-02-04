/**
 * YouTube Live Integration Test
 *
 * Run with: npm test -- tests/live/youtube/youtube.live.test.mjs
 *
 * Requires:
 * - YouTube download configuration
 * - yt-dlp installed
 *
 * Note: youtube.mjs reads process.env.path at module load time,
 * so we must set it before importing.
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

// FAIL early if data path not configured
const dataPath = getDataPath();
if (!dataPath) {
  throw new Error('[PRECONDITION FAILED] Data path not configured. Set DAYLIGHT_DATA_PATH.');
}
process.env.path = { data: dataPath, media: dataPath };

let youtubeHarvest;
let moduleError = null;
try {
  const mod = await import('#backend/lib/youtube.mjs');
  youtubeHarvest = mod.default;
} catch (e) {
  moduleError = e.message;
}

describe('YouTube Live Integration', () => {
  beforeAll(() => {
    // FAIL if data path not configured
    requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if module didn't load
    if (moduleError || !youtubeHarvest) {
      throw new Error(
        `[PRECONDITION FAILED] YouTube module not loaded: ${moduleError || 'unknown error'}. ` +
        'Ensure yt-dlp is installed and accessible.'
      );
    }
  });

  it('processes youtube queue', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const result = await youtubeHarvest(`test-${Date.now()}`, { targetUsername: username });

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`YouTube skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] YouTube error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (result?.processed !== undefined) {
      console.log(`Processed ${result.processed} videos`);
      expect(result.processed).toBeGreaterThanOrEqual(0);
    } else {
      console.log('YouTube harvest completed');
    }
  }, 120000);
});
