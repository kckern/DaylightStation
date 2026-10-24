import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const events = vi.hoisted(() => []);
vi.mock('@/lib/logging/Logger.js', () => {
  const logger = { child: () => logger, debug: (e, d) => events.push([e, d]), info: () => {}, warn: () => {}, error: () => {}, sampled: () => {} };
  return { default: () => logger };
});
import RiderHrTrend from './RiderHrTrend.jsx';

const series = {
  heart_rate: [110, 125, 150, null, 170, 172],
  zone_id: ['active', 'warm', 'hot', null, 'fire', 'fire'],
};

describe('RiderHrTrend', () => {
  it('draws zone-coloured runs, breaks on a gap, and logs its mount', () => {
    const getSeries = vi.fn((_id, metric, options) => { expect(options).toEqual({ clone: false }); return series[metric]; });
    const { container } = render(<RiderHrTrend participantId="|rider-a" getSeries={getSeries} tickCount={6} thresholds={[0, 100, 120, 140, 160]} profileId="rider-a" cardHeight={200} />);
    const lines = [...container.querySelectorAll('polyline')];
    // A one-bucket run (the lone 'active' point) has no segment of its own; the
    // segment into the next bucket wears the zone it rises into. The gap
    // before Fire splits the line.
    expect(lines.map((l) => l.getAttribute('stroke'))).toEqual(['#ffd43b', '#ff922b', '#ff6b6b']);
    expect(container.querySelectorAll('.rider-hr-trend__guide').length).toBeGreaterThan(0);
    expect(events.some(([e, d]) => e === 'fitness.sidebar.hr_trend.mount' && d.profileId === 'rider-a' && d.cardHeight === 200)).toBe(true);
  });
  it('recomputes only on a new tick, not on every parent render', () => {
    const getSeries = vi.fn((_id, metric) => series[metric]);
    const props = { participantId: '|rider-a', getSeries, tickCount: 6, thresholds: [100, 160], profileId: 'rider-a', cardHeight: 200 };
    const { rerender } = render(<RiderHrTrend {...props} />);
    const reads = getSeries.mock.calls.length;
    rerender(<RiderHrTrend {...props} getSeries={(...a) => getSeries(...a)} />);
    expect(getSeries.mock.calls.length).toBe(reads);
    rerender(<RiderHrTrend {...props} tickCount={7} />);
    expect(getSeries.mock.calls.length).toBe(reads + 2);
  });
});
