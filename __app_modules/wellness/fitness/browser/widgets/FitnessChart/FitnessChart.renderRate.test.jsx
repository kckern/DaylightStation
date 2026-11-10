/**
 * Audit 2026-10-29: FitnessChart re-rendered 15–17 times a second
 * (`fitness.render_thrashing`) because every heart-rate sample gave the
 * fitness context — and so the chart — a new roster, series getter and
 * display map. Heart-rate-only context churn must not re-render the chart.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';

const counts = { chart: 0 };
const moduleRef = { current: null };
vi.mock('../../hooks/fitness/useRenderProfiler.js', () => ({ useRenderProfiler: (name) => { if (name === 'FitnessChart') counts.chart += 1; } }));
vi.mock('../../player/useFitnessModule.js', () => ({ default: () => moduleRef.current }));

import FitnessChart from './FitnessChart.jsx';

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  }
});

const timebase = { tickCount: 3, intervalMs: 5000, startTime: 0 };
const series = { heart_beats: [10, 20, 30], heart_rate: [120, 121, 122], zone_id: ['active', 'active', 'active'], rings_total: [1, 2, 3] };
// Fields the real context keeps referentially stable across HR samples
// (memoised config, cached collections, useCallback'd registration).
const stable = {
  historicalParticipants: [],
  registerLifecycle: () => {},
  activityMonitor: null,
  zoneConfig: [],
  configuredUsers: {},
  governanceConfig: {},
  transferredUsers: new Set(),
};
// Fields that get a NEW identity on every heart-rate sample in the real
// context: the roster (its signature includes HR), the series getter and the
// display map (both memoised on the context version), and an empty meta Map.
const makeModule = (hr, over = {}) => ({
  ...stable,
  participants: [{ id: 'rider_a', profileId: 'rider_a', name: 'A', hrDeviceId: '1', zoneColor: '#0f0', isActive: true, heartRate: hr }],
  getUserTimelineSeries: (id, metric) => series[metric] || [],
  timebase,
  sessionId: 'fs_1',
  participantDisplayMap: new Map([['rider_a', { heartRate: hr }]]),
  sessionParticipantsMeta: new Map(),
  ...over,
});

describe('FitnessChart render rate', () => {
  it('ten heart-rate-only context renders do not re-render the chart view ten times', () => {
    moduleRef.current = makeModule(120);
    const { rerender } = render(<FitnessChart mode="sidebar" onClose={() => {}} />);
    const afterMount = counts.chart;
    for (let i = 1; i <= 10; i++) {
      moduleRef.current = makeModule(120 + i);
      act(() => { rerender(<FitnessChart mode="sidebar" onClose={() => {}} />); });
    }
    // The legend's HR readout is throttled to 1 Hz; everything else is HR-free.
    expect(counts.chart - afterMount).toBeLessThanOrEqual(2);
  });

  it('a new timeline tick does re-render it', () => {
    moduleRef.current = makeModule(120);
    const { rerender } = render(<FitnessChart mode="sidebar" onClose={() => {}} />);
    const before = counts.chart;
    timebase.tickCount = 4;
    moduleRef.current = makeModule(120);
    act(() => { rerender(<FitnessChart mode="sidebar" onClose={() => {}} />); });
    expect(counts.chart).toBeGreaterThan(before);
  });
});
