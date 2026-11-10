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
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls('today')).toBe(first + 1);
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
