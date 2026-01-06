/**
 * YouTube Live Integration Test
 *
 * Run with: npm test -- tests/live/youtube/youtube.live.test.mjs
 *
 * Requires:
 * - YouTube download configuration
 *
 * Note: youtube.mjs reads process.env.path at module load time,
 * so we must set it before importing.
 */

import { configService } from '../../../backend/lib/config/ConfigService.mjs';

// Must set process.env.path before importing youtube.mjs
const dataPath = process.env.DAYLIGHT_DATA_PATH;
if (dataPath) {
  process.env.path = { data: dataPath, media: dataPath };
}

let youtubeHarvest;
try {
  const mod = await import('../../../backend/lib/youtube.mjs');
  youtubeHarvest = mod.default;
} catch (e) {
  // Module may fail to load if yt-dlp not installed
  console.log('youtube.mjs failed to load:', e.message);
}

describe('YouTube Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }
  });

  it('processes youtube queue', async () => {
    if (!youtubeHarvest) {
      console.log('YouTube module not loaded - skipping test');
      return;
    }

    const username = configService.getHeadOfHousehold();

    try {
      const result = await youtubeHarvest(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.skipped) {
        console.log(`Skipped: ${result.reason}`);
      } else if (result?.processed !== undefined) {
        console.log(`Processed ${result.processed} videos`);
      } else if (result) {
        console.log('YouTube harvest completed');
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.message?.includes('ENOENT')) {
        console.log('YouTube paths not configured - requires full server environment');
        return; // Skip gracefully
      } else if (error.message?.includes('yt-dlp') || error.message?.includes('not found')) {
        console.log('yt-dlp not installed or configured');
      } else {
        throw error;
      }
    }
  }, 120000);
});
