/**
 * WeatherHarvester
 *
 * Fetches weather data from Open-Meteo API.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Note: Weather data is shared at household level, not user-specific.
 *
 * Features:
 * - Hourly forecast (3 days)
 * - Air quality index
 * - Temperature, precipitation, cloud cover
 *
 * @module harvester/other/WeatherHarvester
 */

import { fetchWeatherApi } from 'openmeteo';
import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Weather data harvester
 * @implements {IHarvester}
 */
export class WeatherHarvester extends IHarvester {
  #sharedStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.sharedStore - Store for shared household data
   * @param {Object} config.configService - ConfigService for location config
   * @param {string} [config.timezone] - Timezone for date formatting
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    sharedStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!sharedStore) {
      throw new InfrastructureError('WeatherHarvester requires sharedStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'sharedStore'
      });
    }

    this.#sharedStore = sharedStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 30 * 60 * 1000, // 30 mins max for weather
      logger: logger,
    });
  }

  get serviceId() {
    return 'weather';
  }

  get category() {
    return HarvesterCategory.OTHER;
  }

  /**
   * Harvest weather data from Open-Meteo
   *
   * @param {string} username - Target user (used for household lookup)
   * @param {Object} [options] - Harvest options
   * @param {number} [options.forecastDays=3] - Days of forecast
   * @returns {Promise<{ status: string, current: Object }>}
   */
  async harvest(username, options = {}) {
    const { forecastDays = 3 } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('weather.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('weather.harvest.start', { username, forecastDays });

      // Get location from config (use injected configService, fallback to global)
      const cfg = this.#configService || configService;
      // Try system.weather first, then adapters.weather, then secrets
      const weatherConfig = cfg?.isReady?.()
        ? (cfg.get?.('weather') || cfg.getAdapterConfig?.('weather'))
        : null;
      const lat = weatherConfig?.lat || cfg.getSecret?.('WEATHER_LAT');
      const lng = weatherConfig?.lng || cfg.getSecret?.('WEATHER_LNG');
      const tz = weatherConfig?.timezone || this.#timezone;

      if (!lat || !lng) {
        throw new InfrastructureError('Weather location not configured (WEATHER_LAT/WEATHER_LNG)', {
        code: 'MISSING_CONFIG',
        service: 'Weather'
      });
      }

      // Fetch weather and air quality in parallel
      const [weatherResponses, airQualityResponses] = await Promise.all([
        fetchWeatherApi('https://api.open-meteo.com/v1/forecast', {
          latitude: lat,
          longitude: lng,
          hourly: ['temperature_2m', 'apparent_temperature', 'precipitation', 'weather_code', 'cloud_cover'],
          forecast_days: forecastDays,
        }),
        fetchWeatherApi('https://air-quality-api.open-meteo.com/v1/air-quality', {
          latitude: lat,
          longitude: lng,
          current: ['pm10', 'pm2_5', 'us_aqi', 'european_aqi'],
        }),
      ]);

      const weatherResponse = weatherResponses[0];
      const airQualityResponse = airQualityResponses[0];
      const currentAir = airQualityResponse.current();

      const utcOffsetSeconds = weatherResponse.utcOffsetSeconds();
      const hourlyWeather = weatherResponse.hourly();

      // Build hourly data
      const hourly = this.#buildHourlyData(hourlyWeather, utcOffsetSeconds, tz);

      // Find current weather
      const now = moment.tz(new Date(), tz);
      const current = hourly.find(({ unix }) => unix > now.unix()) || hourly[0];

      const weatherData = {
        now: now.toISOString(),
        unix: now.unix(),
        current: {
          ...current,
          aqi: currentAir.variables(2).value(),
          pm10: currentAir.variables(0).value(),
          pm2_5: currentAir.variables(1).value(),
        },
        hourly,
      };

      // Save to shared household store
      await this.#sharedStore.save(weatherData);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('weather.harvest.complete', {
        username,
        hourlyCount: hourly.length,
        currentTemp: current?.temp,
      });

      return {
        status: 'success',
        current: weatherData.current,
        hourlyCount: hourly.length,
      };

    } catch (error) {
      this.#circuitBreaker.recordFailure(error);

      this.#logger.error?.('weather.harvest.error', {
        username,
        error: error.message,
        circuitState: this.#circuitBreaker.getStatus().state,
      });

      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Build hourly data array from API response
   * @private
   */
  #buildHourlyData(hourlyWeather, utcOffsetSeconds, tz) {
    const range = (start, stop, step) =>
      Array.from({ length: (stop - start) / step }, (_, i) => start + i * step);

    return range(
      Number(hourlyWeather.time()),
      Number(hourlyWeather.timeEnd()),
      hourlyWeather.interval()
    ).map((t, index) => ({
      time: moment.tz((t + utcOffsetSeconds) * 1000, tz).format('YYYY-MM-DD HH:mm:ss'),
      unix: t + utcOffsetSeconds,
      temp: hourlyWeather.variables(0).valuesArray()[index],
      feel: hourlyWeather.variables(1).valuesArray()[index],
      precip: hourlyWeather.variables(2).valuesArray()[index],
      code: hourlyWeather.variables(3).valuesArray()[index],
      cloud: hourlyWeather.variables(4).valuesArray()[index],
    }));
  }
}

export default WeatherHarvester;
