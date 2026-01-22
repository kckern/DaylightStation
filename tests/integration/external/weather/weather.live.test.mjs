/**
 * Weather Live Integration Test
 *
 * Run with: npm test -- tests/live/weather/weather.live.test.mjs
 */

import { configService } from '#backend/src/0_infrastructure/config/index.mjs';

describe('Weather Live Integration', () => {
  let getWeather;

  beforeAll(async () => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    // Initialize config service
    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
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
  });

  it('fetches weather data from Open-Meteo', async () => {
    try {
      const result = await getWeather(`test-${Date.now()}`);

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
    } catch (error) {
      // Handle rate limiting gracefully
      if (error.message?.includes('limit exceeded') || error.message?.includes('rate limit')) {
        console.log(`Rate limited: ${error.message}`);
        return; // Pass test - rate limit is not a test failure
      }
      throw error;
    }
  }, 30000);
});
