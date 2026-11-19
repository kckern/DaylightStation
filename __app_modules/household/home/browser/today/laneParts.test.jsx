import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useTimeline } from './useTimeline.js';
import { laneEntity } from './LaneDetailSheet.jsx';
import { topCircuits } from './PowerBreakdown.jsx';
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

const calls = (range) => apiMock.mock.calls.filter(([p]) => p === `api/v1/home-dashboard/timeline?range=${range}`).length;
const setVisibility = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });

describe('useTimeline polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockReset();
    apiMock.mockResolvedValue({ range: 'x', lanes: [], days: [] });
    resetApiResourceCache?.();
    setVisibility('visible');
  });
  afterEach(() => { vi.useRealTimers(); setVisibility('visible'); });

  it('re-reads today every minute while the page is visible', async () => {
    renderHook(() => useTimeline('today'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const first = calls('today');
    expect(first).toBeGreaterThan(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls('today')).toBe(first + 1);
    setVisibility('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls('today')).toBe(first + 1);
  });

  it('restarts the minute on foreground and drops the old timer when the range changes', async () => {
    const view = renderHook(({ range }) => useTimeline(range), { initialProps: { range: 'today' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(58_000); });
    setVisibility('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    setVisibility('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(calls('today')).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls('today')).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(calls('today')).toBe(3);
    view.rerender({ range: 'yesterday' });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls('today')).toBe(3);
    expect(calls('yesterday')).toBe(1);
  });

  it('keeps the selected range when a previous day responds late', async () => {
    let finishToday;
    apiMock.mockImplementation(path => path.endsWith('=today')
      ? new Promise(resolve => { finishToday = resolve; })
      : Promise.resolve({ range: 'yesterday', days: [], lanes: [] }));
    const view = renderHook(({ range }) => useTimeline(range), { initialProps: { range: 'today' } });
    view.rerender({ range: 'yesterday' });
    await act(async () => {});
    expect(view.result.current.timeline.range).toBe('yesterday');
    await act(async () => finishToday({ range: 'today', days: [], lanes: [] }));
    expect(view.result.current.timeline.range).toBe('yesterday');
  });

  it('never re-reads the settled week', async () => {
    renderHook(() => useTimeline('week'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const first = calls('week');
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(calls('week')).toBe(first);
  });
});

describe('laneEntity', () => {
  const lane = { id: 'den', kind: 'occupancy', label: 'Den', entityIds: { primary: 'binary_sensor.den_presence' } };
  it('uses the listed entity when /entities has it', () => {
    const e = { id: 'binary_sensor.den_presence', name: 'Den presence' };
    expect(laneEntity(lane, [e])).toBe(e);
  });
  it('stands in with the lane name when /entities omits the primary', () => {
    expect(laneEntity(lane, [])).toMatchObject({
      id: 'binary_sensor.den_presence', domain: 'binary_sensor', name: 'Den', stateClass: 'unknown', controllable: false,
    });
  });
});

describe('topCircuits', () => {
  it('leaves the whole-house meter (and its energy counter) out of the ranking', () => {
    const entities = ['sensor.panel_power', 'sensor.panel_energy', 'sensor.office_power'].map((id) => ({ id, name: id }));
    const summary = { power: {
      wholeHouse: { entityId: 'sensor.panel_power', watts: 900 },
      energyToday: { entityId: 'sensor.panel_energy', kwh: 3 },
      topConsumers: [{ entityId: 'sensor.panel_power', watts: 900 }, { entityId: 'sensor.panel_energy', watts: 1 }, { entityId: 'sensor.office_power', watts: 300 }],
    } };
    expect(topCircuits(entities, summary).map((c) => c.entityId)).toEqual(['sensor.office_power']);
  });
  it('a meter reading as much as the whole house (a second panel total) is not a circuit', () => {
    const entities = ['sensor.panel_power', 'sensor.panel_mirror_power', 'sensor.office_power'].map((id) => ({ id, name: id }));
    const summary = { power: {
      wholeHouse: { entityId: 'sensor.panel_power', watts: 900 },
      topConsumers: [{ entityId: 'sensor.panel_mirror_power', watts: 900 }, { entityId: 'sensor.office_power', watts: 300 }],
    } };
    expect(topCircuits(entities, summary).map((c) => c.entityId)).toEqual(['sensor.office_power']);
  });
});
