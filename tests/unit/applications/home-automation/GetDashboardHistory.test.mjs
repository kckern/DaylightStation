import { describe, it, expect, vi } from 'vitest';
import { GetDashboardHistory } from '#apps/home-automation/usecases/GetDashboardHistory.mjs';

const config = {
  summary: {
    temp_chart: {
      hours: 36,
      series: [
        { entity: 'sensor.indoor',  label: 'Indoor',  color: '#4dabf7' },
        { entity: 'sensor.outdoor', label: 'Outdoor', color: '#ffa94d' },
      ],
    },
    energy_chart: { hours: 24, entity: 'sensor.energy_today', color: '#63e6be' },
  },
  rooms: [],
};

describe('GetDashboardHistory', () => {
  it('fetches temp and energy series, downsamples, returns per-chart payload', async () => {
    const mkSeries = (n, base) =>
      Array.from({ length: n }, (_, i) => ({ t: `t${i}`, v: base + i }));
    const historyMap = new Map([
      ['sensor.indoor',        mkSeries(500, 70)],
      ['sensor.outdoor',       mkSeries(500, 50)],
      ['sensor.energy_today',  mkSeries(500, 0)],
    ]);
    const haGateway = { getHistory: vi.fn().mockResolvedValue(historyMap) };
    const now = new Date('2026-04-20T12:00:00Z');

    const uc = new GetDashboardHistory({
      configRepository: { load: async () => config },
      haGateway,
      clock: () => now,
    });

    const result = await uc.execute();

    expect(result.tempChart.series).toHaveLength(2);
    expect(result.tempChart.series[0].label).toBe('Indoor');
    expect(result.tempChart.series[0].points.length).toBeLessThanOrEqual(150);
    expect(result.energyChart.points.length).toBeLessThanOrEqual(150);
    // since = now - hours, so gateway was called with an ISO 36h before now
    const call = haGateway.getHistory.mock.calls[0];
    expect(call[0]).toEqual(expect.arrayContaining([
      'sensor.indoor', 'sensor.outdoor', 'sensor.energy_today',
    ]));
    expect(call[1].sinceIso).toBe('2026-04-19T00:00:00.000Z'); // 36h before
  });

  it('returns null chart blocks when config lacks that chart', async () => {
    const uc = new GetDashboardHistory({
      configRepository: { load: async () => ({ summary: {}, rooms: [] }) },
      haGateway: { getHistory: vi.fn().mockResolvedValue(new Map()) },
      clock: () => new Date(),
    });
    const result = await uc.execute();
    expect(result.tempChart).toBeNull();
    expect(result.energyChart).toBeNull();
  });
});
