// backend/src/1_adapters/feed/sources/WeatherFeedAdapter.mjs
/**
 * WeatherFeedAdapter
 *
 * Reads weather data from DataService and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/WeatherFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

export class WeatherFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) throw new Error('WeatherFeedAdapter requires dataService');
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'weather'; }

  async fetchItems(query, _username) {
    try {
      const data = this.#dataService.household.read('common/weather');
      if (!data?.current) return [];

      const current = data.current;
      const tempF = Math.round(current.temp * 9 / 5 + 32);
      const feelsF = Math.round(current.feel * 9 / 5 + 32);
      const condition = WMO_CODES[current.code] || 'Weather';

      return [{
        id: `weather:${new Date().toISOString().split('T')[0]}`,
        tier: query.tier || 'compass',
        source: 'weather',
        title: condition,
        body: `${tempF}\u00b0F (feels ${feelsF}\u00b0F)`,
        image: null,
        link: null,
        timestamp: data.now || new Date().toISOString(),
        priority: query.priority || 3,
        meta: {
          tempF, feelsF, tempC: Math.round(current.temp),
          cloud: current.cloud, precip: current.precip,
          aqi: Math.round(current.aqi || 0), code: current.code,
          sourceName: 'Weather', sourceIcon: null,
        },
      }];
    } catch (err) {
      this.#logger.warn?.('weather.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta, _username) {
    const items = [];
    if (meta.tempF != null) items.push({ label: 'Temperature', value: `${meta.tempF}°F` });
    if (meta.feelsF != null) items.push({ label: 'Feels Like', value: `${meta.feelsF}°F` });
    if (meta.cloud != null) items.push({ label: 'Cloud Cover', value: `${meta.cloud}%` });
    if (meta.precip != null) items.push({ label: 'Precipitation', value: `${meta.precip} mm` });
    if (meta.aqi) items.push({ label: 'AQI', value: String(meta.aqi) });
    if (items.length === 0) return null;
    return { sections: [{ type: 'stats', data: { items } }] };
  }
}
