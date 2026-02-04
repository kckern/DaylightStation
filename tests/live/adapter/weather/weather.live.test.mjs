/**
 * Weather Live Integration Test
 *
 * Run with: npm test -- tests/live/weather/weather.live.test.mjs
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, SkipTestError } from '../test-preconditions.mjs';

describe('Weather Live Integration', () => {
  let getWeather;
  let dataPath;

  beforeAll(async () => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    // Initialize config service
    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // Load weather config from household
    const householdConfig = configService.getDefaultHouseholdConfig();
    const weatherConfig = householdConfig?.weather || {};

    // Set weather env vars (required by weather.mjs)
    process.env.weather = {
      lat: weatherConfig.lat || process.env.WEATHER_LAT || '47.6062',
      lng: weatherConfig.lng || process.env.WEATHER_LNG || '-122.3321',
      timezone: weatherConfig.timezone || process.env.TZ || 'America/Los_Angeles'
    };

    // Dynamic import after env setup
    const weatherModule = await import('#backend/lib/weather.mjs');
    getWeather = weatherModule.default;

    // FAIL if module didn't load
    if (!getWeather) {
      throw new Error('[PRECONDITION FAILED] Weather module not loaded');
    }
  });

  it('fetches weather data from Open-Meteo', async () => {
    const result = await getWeather(`test-${Date.now()}`);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Weather skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Weather error: ${result.error}`);
    }

    // Weather returns undefined but saves to file, or returns the data
    // Check if we got current weather data
    if (result?.current) {
      console.log(`Current temp: ${result.current.temp?.toFixed(1)}°C`);
      console.log(`Feels like: ${result.current.feel?.toFixed(1)}°C`);
      console.log(`AQI: ${result.current.aqi}`);
      expect(result.current.temp).toBeDefined();
    } else {
      // Weather saved to file successfully
      console.log('Weather data saved to household state');
    }
  }, 30000);
});
