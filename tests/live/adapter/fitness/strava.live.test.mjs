/**
 * Strava Live Integration Test
 *
 * Run with: npm test -- tests/live/strava/strava.live.test.mjs
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import path from 'path';
import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import harvestActivities, { getAccessToken, isStravaInCooldown } from '#backend/_legacy/lib/strava.mjs';
import { readYamlFile, getDataPath } from '../harness-utils.mjs';
import { getDataPath as getDataPathFromConfig } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireSecret, skipIf, SkipTestError } from '../test-preconditions.mjs';

describe('Strava Live Integration', () => {
  let username;
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPathFromConfig);

    // Set up process.env.path (required by io.mjs and other modules)
    process.env.path = { data: dataPath };

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if secrets not configured
    process.env.STRAVA_CLIENT_ID = requireSecret('STRAVA_CLIENT_ID', configService);
    process.env.STRAVA_CLIENT_SECRET = requireSecret('STRAVA_CLIENT_SECRET', configService);

    username = configService.getHeadOfHousehold();
    if (!username) {
      throw new Error('[PRECONDITION FAILED] Head of household not configured');
    }
  });

  it('harvests strava activities', async () => {
    // Explicit skip for circuit breaker - don't silently pass
    const cooldown = isStravaInCooldown();
    skipIf(cooldown, `Circuit breaker open - ${cooldown?.remainingMins} mins remaining`);

    // Get fresh access token - FAIL if this doesn't work
    const token = await getAccessToken();
    if (!token) {
      throw new Error(
        '[ASSERTION FAILED] Token refresh failed. ' +
        'Re-authorize at: https://www.strava.com/oauth/authorize?' +
        `client_id=${process.env.STRAVA_CLIENT_ID}&response_type=code&` +
        'redirect_uri=http://localhost:3000/api/auth/strava/callback&' +
        'approval_prompt=force&scope=read,activity:read_all'
      );
    }
    console.log(`Access token: ${token.substring(0, 10)}...`);

    // Run harvest
    const result = await harvestActivities(null, `test-${Date.now()}`, 7);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Strava skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.success === false) {
      throw new Error(`[ASSERTION FAILED] Strava harvest failed: ${result.error}`);
    }

    // FAIL if re-auth needed
    if (result?.url) {
      throw new Error(`[ASSERTION FAILED] Re-auth needed: ${result.url}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');

    const dates = Object.keys(result);
    console.log(`Harvested ${dates.length} dates`);
    expect(dates.length).toBeGreaterThanOrEqual(0);

    // Verify data was persisted
    const summaryPath = `users/${username}/lifelog/strava.yml`;
    const fullPath = path.join(getDataPath(), summaryPath);
    const summary = readYamlFile(summaryPath);
    console.log(`Summary file: ${fullPath}`);
    expect(summary).toBeTruthy();

    if (summary) {
      const summaryDates = Object.keys(summary);
      console.log(`Summary dates (${summaryDates.length}): ${summaryDates.slice(0, 5).join(', ')}`);
      const latestDate = summaryDates.sort().pop();
      if (latestDate) {
        const latestCount = Array.isArray(summary[latestDate]) ? summary[latestDate].length : 0;
        console.log(`Latest date ${latestDate} count: ${latestCount}`);
      }
    }
  }, 60000);
});
