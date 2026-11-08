import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const events = vi.hoisted(() => []);
vi.mock('@/lib/logging/Logger.js', () => {
  const logger = { child: () => logger, debug: (e, d) => events.push([e, d]), info: (e, d) => events.push([e, d]), warn: () => {}, error: () => {}, sampled: () => {} };
  return { default: () => logger };
});
import RiderHrTrend from './RiderHrTrend.jsx';

const zones = [
  { id: 'cool', threshold: 0 }, { id: 'active', threshold: 100 }, { id: 'warm', threshold: 120 },
  { id: 'hot', threshold: 140 }, { id: 'fire', threshold: 160 },
];
const series = { heart_rate: [110, 125, 150, null, 170, 172] };
const base = {
  participantId: '|rider-a', profileId: 'rider-a', cardHeight: 200, tickMs: 5000, zones, tickCount: 6,
  getSeries: (_id, metric) => series[metric],
};
const lastPoint = (d) => {
  const pairs = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
  return pairs.at(-1).slice(1).map(Number);
};

describe('RiderHrTrend', () => {
  it('shows the collecting spinner until five real readings, keeping its box', () => {
    const s = { heart_rate: [110, null, 120, 125] };
    const { container } = render(<RiderHrTrend {...base} getSeries={(_i, m) => s[m]} tickCount={4} />);
    expect(container.querySelector('.rider-hr-trend--loading[role="status"]')).not.toBeNull();
    expect(container.querySelector('.rider-hr-trend__spinner')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws one path clipped once per zone band, coloured by band', () => {
    const { container } = render(<RiderHrTrend {...base} />);
    const uses = [...container.querySelectorAll('use')];
    expect(uses.map((u) => u.getAttribute('stroke'))).toEqual(['#6ab8ff', '#51cf66', '#ffd43b', '#ff922b', '#ff6b6b']);
    expect(container.querySelectorAll('path.rider-hr-trend__line')).toHaveLength(1);
    expect(new Set(uses.map((u) => u.getAttribute('clip-path'))).size).toBe(uses.length);
    expect(container.querySelectorAll('.rider-hr-trend__guide').length).toBeGreaterThan(0);
    expect(container.querySelector('.rider-hr-trend__plot').getAttribute('transform')).toMatch(/^matrix\(1 0 0 -/);
  });

  it('never reads zone_id; the colour comes from height', () => {
    const getSeries = vi.fn((_id, metric) => series[metric]);
    render(<RiderHrTrend {...base} getSeries={getSeries} />);
    expect(getSeries.mock.calls.map((c) => c[1])).not.toContain('zone_id');
    expect(getSeries.mock.calls.every((c) => c[2]?.clone === false)).toBe(true);
  });

  it('ends the line at the right edge for a series shorter than tickCount (late joiner)', () => {
    const s = { heart_rate: [120, 121, 122, 123, 124, 125, 126, 127] };
    const { container } = render(<RiderHrTrend {...base} getSeries={(_i, m) => s[m]} tickCount={40} />);
    const [x, hr] = lastPoint(container.querySelector('path.rider-hr-trend__line').getAttribute('d'));
    expect(x).toBe(100);
    expect(hr).toBe(127);
  });

  it('two cards on one page get distinct clipPath ids', () => {
    const { container } = render(<><RiderHrTrend {...base} /><RiderHrTrend {...base} participantId="|rider-b" profileId="rider-b" /></>);
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it('logs fitness.sidebar.hr_trend.ready once when the spinner gives way', () => {
    events.length = 0;
    const s = { heart_rate: [110, 111, 112, 113] };
    const props = { ...base, getSeries: (_i, m) => s[m], tickCount: 4 };
    const { rerender } = render(<RiderHrTrend {...props} />);
    s.heart_rate.push(114);
    rerender(<RiderHrTrend {...props} tickCount={5} />);
    s.heart_rate.push(115);
    rerender(<RiderHrTrend {...props} tickCount={6} />);
    const ready = events.filter(([e]) => e === 'fitness.sidebar.hr_trend.ready');
    expect(ready).toHaveLength(1);
    expect(ready[0][1]).toMatchObject({ profileId: 'rider-a', readings: 5 });
  });

  it('recomputes only on a new tick, not on every parent render', () => {
    const getSeries = vi.fn((_id, metric) => series[metric]);
    const props = { ...base, getSeries };
    const { rerender } = render(<RiderHrTrend {...props} />);
    const reads = getSeries.mock.calls.length;
    rerender(<RiderHrTrend {...props} getSeries={(...a) => getSeries(...a)} />);
    expect(getSeries.mock.calls.length).toBe(reads);
    rerender(<RiderHrTrend {...props} tickCount={7} />);
    expect(getSeries.mock.calls.length).toBe(reads + 1);
  });

  it('logs its mount with the card height', () => {
    events.length = 0;
    render(<RiderHrTrend {...base} />);
    expect(events.some(([e, d]) => e === 'fitness.sidebar.hr_trend.mount' && d.profileId === 'rider-a' && d.cardHeight === 200)).toBe(true);
  });
});
