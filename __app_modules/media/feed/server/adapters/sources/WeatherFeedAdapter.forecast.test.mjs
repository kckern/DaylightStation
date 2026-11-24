import { describe, it, expect } from 'vitest';
import { WeatherFeedAdapter, dayForecast } from './WeatherFeedAdapter.mjs';

const DATA = {
  now: '2026-11-24T12:00:00Z',
  current: { time: '2026-11-24 05:00:00', temp: -2, feel: -6, precip: 0, code: 71, cloud: 100, aqi: 20 },
  hourly: [
    { time: '2026-11-23 23:00:00', temp: 20, precip: 5, code: 61 },
    { time: '2026-11-24 05:00:00', temp: -2, precip: 0.4, code: 71 },
    { time: '2026-11-24 11:00:00', temp: 3, precip: 0.2, code: 71 },
    { time: '2026-11-24 15:00:00', temp: 5, precip: 0, code: 3 },
    { time: '2026-11-24 21:00:00', temp: 0, precip: 0, code: 71 },
    { time: '2026-11-25 09:00:00', temp: 30, precip: 0, code: 0 },
  ],
};

describe('WeatherFeedAdapter day forecast', () => {
  it('summarizes the current local day from the hourly series', () => {
    expect(dayForecast(DATA)).toEqual({ date: '2026-11-24', highF: 41, lowF: 28, condition: 'Light snow', precipPct: 50, hours: 4 });
  });

  it('is null without hourly data', () => {
    expect(dayForecast({ current: DATA.current })).toBeNull();
  });

  it('rides along in the feed item meta', async () => {
    const adapter = new WeatherFeedAdapter({ dataService: { household: { read: () => DATA } }, logger: { warn() {} } });
    const [item] = await adapter.fetchItems({}, 'u');
    expect(item.meta.forecast).toMatchObject({ highF: 41, lowF: 28 });
    expect(item.meta.tempF).toBe(28);
  });
});
