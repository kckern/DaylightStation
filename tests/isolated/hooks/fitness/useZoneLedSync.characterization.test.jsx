/**
 * Characterization test for useZoneLedSync.
 *
 * Captures the OBSERVABLE behavior of the production zone-LED sync hook so that
 * the Task 6 refactor (delegating to useFitnessStateSync) can be proven
 * behavior-preserving. These assertions must hold for BOTH the original
 * implementation and the refactored one.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const postMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: (...args) => postMock(...args),
}));

import { useZoneLedSync } from '@/hooks/fitness/useZoneLedSync.js';

describe('useZoneLedSync characterization', () => {
  beforeEach(() => {
    postMock.mockClear();
    if (typeof navigator !== 'undefined') navigator.sendBeacon = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  test('POSTs zones (zoneId + isActive) with sessionEnded:false after a zone change + debounce', async () => {
    let roster = [{ zoneId: 'warm', isActive: true }];
    const { rerender } = renderHook(() =>
      useZoneLedSync({
        participantRoster: roster,
        sessionActive: true,
        enabled: true,
        householdId: 'test',
      })
    );
    roster = [{ zoneId: 'fire', isActive: true }];
    rerender();
    await vi.advanceTimersByTimeAsync(5000);

    expect(postMock).toHaveBeenCalled();
    const [endpoint, payload, method] = postMock.mock.calls.at(-1);
    expect(endpoint).toBe('api/v1/fitness/zone_led');
    expect(method).toBe('POST');
    expect(payload.sessionEnded).toBe(false);
    expect(Array.isArray(payload.zones)).toBe(true);
    expect(payload.zones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ zoneId: expect.any(String), isActive: expect.any(Boolean) }),
      ])
    );
  });

  test('immediately POSTs { zones: [], sessionEnded: true } when sessionActive flips true->false', () => {
    const baseProps = {
      participantRoster: [{ zoneId: 'warm', isActive: true }],
      sessionActive: true,
      enabled: true,
      householdId: 'test',
    };
    const { rerender } = renderHook((p) => useZoneLedSync(p), {
      initialProps: baseProps,
    });
    postMock.mockClear();
    rerender({ ...baseProps, sessionActive: false });

    expect(postMock).toHaveBeenCalledWith(
      'api/v1/fitness/zone_led',
      expect.objectContaining({ zones: [], sessionEnded: true }),
      'POST'
    );
  });
});
