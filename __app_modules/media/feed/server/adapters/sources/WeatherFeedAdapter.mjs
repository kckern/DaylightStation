// __backend/src/1_adapters/feed/sources/WeatherFeedAdapter.mjs
/**
 * WeatherFeedAdapter
 *
 * Reads weather data from DataService and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/WeatherFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from "../../application/ports/IFeedSourceAdapter.mjs";

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

const cToF = (c) => Math.round((c * 9) / 5 + 32);

/**
 * The current local day from the hourly series (its `time` strings are
 * household-local wall clock; the day is `current.time`'s): high/low in °F,
 * the most frequent condition, and `precipPct`, the share of that day's hours
 * in the series with measurable
 * precipitation (≥ 0.1 mm). The harvester stores amounts, not a probability,
 * so this is an hours-share, not a forecast chance. Null without hourly data.
 */
export function dayForecast(data) {
  const day = String(data?.current?.time || '').slice(0, 10);
  const hours = (Array.isArray(data?.hourly) ? data.hourly : [])
    .filter((h) => String(h.time || '').slice(0, 10) === day && Number.isFinite(h.temp));
  if (!day || !hours.length) return null;
  const temps = hours.map((h) => h.temp);
  const counts = {};
  for (const h of hours) counts[h.code] = (counts[h.code] || 0) + 1;
  const [code] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const wet = hours.filter((h) => (h.precip || 0) >= 0.1).length;
  return {
    date: day,
    highF: cToF(Math.max(...temps)),
    lowF: cToF(Math.min(...temps)),
    condition: WMO_CODES[code] || null,
    precipPct: Math.round((wet / hours.length) * 100),
    hours: hours.length,
  };
}

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
  get provides() { return [CONTENT_TYPES.WEATHER]; }

  async fetchItems(query, _username) {
    try {
      const data = this.#dataService.household.read('weather/current');
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
          forecast: dayForecast(data),
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
