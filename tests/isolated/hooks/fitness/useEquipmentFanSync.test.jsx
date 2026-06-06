import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const postMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: (...args) => postMock(...args),
}));

import { useEquipmentFanSync } from '@/hooks/fitness/useEquipmentFanSync.js';

describe('useEquipmentFanSync', () => {
  beforeEach(() => {
    postMock.mockClear();
    if (typeof navigator !== 'undefined') navigator.sendBeacon = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  test('POSTs rpm map (keyed by deviceId, read from cadence) + zones to equipment_fan', async () => {
    // rpmDevices match the FitnessContext shape: { deviceId, cadence }.
    let cadence = 0;
    const { rerender } = renderHook(() =>
      useEquipmentFanSync({
        enabled: true,
        sessionActive: true,
        householdId: 'test',
        rpmDevices: [{ deviceId: '7138', cadence }],
        participantRoster: [{ zoneId: 'warm', isActive: true }],
      })
    );
    cadence = 72;
    rerender();
    await vi.advanceTimersByTimeAsync(1000);
    expect(postMock).toHaveBeenCalledWith(
      'api/v1/fitness/equipment_fan',
      expect.objectContaining({
        rpm: { '7138': 72 },
        zones: [{ zoneId: 'warm', isActive: true }],
        sessionEnded: false,
        householdId: 'test',
      }),
      'POST'
    );
  });

  test('sends session-end payload immediately when session ends', () => {
    const props = {
      enabled: true,
      sessionActive: true,
      householdId: 'test',
      rpmDevices: [{ deviceId: '7138', cadence: 80 }],
      participantRoster: [{ zoneId: 'warm', isActive: true }],
    };
    const { rerender } = renderHook((p) => useEquipmentFanSync(p), {
      initialProps: props,
    });
    postMock.mockClear();
    rerender({ ...props, sessionActive: false });
    expect(postMock).toHaveBeenCalledWith(
      'api/v1/fitness/equipment_fan',
      expect.objectContaining({ sessionEnded: true, rpm: {}, zones: [] }),
      'POST'
    );
  });

  test('does not POST when disabled', async () => {
    let cadence = 0;
    const { rerender } = renderHook(() =>
      useEquipmentFanSync({
        enabled: false,
        sessionActive: true,
        householdId: 'test',
        rpmDevices: [{ deviceId: '7138', cadence }],
        participantRoster: [{ zoneId: 'warm', isActive: true }],
      })
    );
    cadence = 72;
    rerender();
    await vi.advanceTimersByTimeAsync(2000);
    expect(postMock).not.toHaveBeenCalled();
  });
});
