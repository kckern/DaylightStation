import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const postMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: (...args) => postMock(...args),
}));

import { useFitnessStateSync } from '@/hooks/fitness/useFitnessStateSync.js';

describe('useFitnessStateSync', () => {
  let beaconMock;
  beforeEach(() => {
    postMock.mockClear();
    // Stub sendBeacon so unmount cleanup doesn't make real network calls.
    beaconMock = vi.fn().mockReturnValue(true);
    if (typeof navigator !== 'undefined') navigator.sendBeacon = beaconMock;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('POSTs the built payload to the endpoint after debounce when signature changes', async () => {
    let signature = 'a';
    const { rerender } = renderHook(() =>
      useFitnessStateSync({
        endpoint: 'api/v1/fitness/equipment_fan',
        enabled: true,
        sessionActive: true,
        buildSignature: () => signature,
        buildPayload: () => ({ marker: signature }),
        debounceMs: 1000,
        throttleMs: 5000,
      })
    );
    signature = 'b';
    rerender();
    await vi.advanceTimersByTimeAsync(1000);
    expect(postMock).toHaveBeenCalledWith(
      'api/v1/fitness/equipment_fan',
      expect.objectContaining({ marker: 'b' }),
      'POST'
    );
  });

  test('does not POST before the debounce window elapses', async () => {
    let signature = 'a';
    const { rerender } = renderHook(() =>
      useFitnessStateSync({
        endpoint: 'api/v1/fitness/equipment_fan',
        enabled: true,
        sessionActive: true,
        buildSignature: () => signature,
        buildPayload: () => ({ marker: signature }),
        debounceMs: 1000,
        throttleMs: 5000,
      })
    );
    signature = 'b';
    rerender();
    await vi.advanceTimersByTimeAsync(500);
    expect(postMock).not.toHaveBeenCalled();
  });

  test('POSTs once for the initial signature then stops while signature is unchanged', async () => {
    const { rerender } = renderHook(() =>
      useFitnessStateSync({
        endpoint: 'api/v1/fitness/equipment_fan',
        enabled: true,
        sessionActive: true,
        buildSignature: () => 'same',
        buildPayload: () => ({ marker: 'same' }),
        debounceMs: 1000,
        throttleMs: 5000,
      })
    );
    // Initial snapshot is reported once after debounce.
    await vi.advanceTimersByTimeAsync(1000);
    expect(postMock).toHaveBeenCalledTimes(1);
    // Subsequent rerenders with the same signature do not re-POST.
    rerender();
    await vi.advanceTimersByTimeAsync(6000);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test('does nothing when disabled', async () => {
    let signature = 'a';
    const { rerender } = renderHook(() =>
      useFitnessStateSync({
        endpoint: 'api/v1/fitness/equipment_fan',
        enabled: false,
        sessionActive: true,
        buildSignature: () => signature,
        buildPayload: () => ({ marker: signature }),
        debounceMs: 1000,
        throttleMs: 5000,
      })
    );
    signature = 'b';
    rerender();
    await vi.advanceTimersByTimeAsync(2000);
    expect(postMock).not.toHaveBeenCalled();
  });

  test('sends session-end payload immediately when sessionActive flips false', async () => {
    const props = {
      endpoint: 'api/v1/fitness/equipment_fan',
      enabled: true,
      sessionActive: true,
      buildSignature: () => 'x',
      buildPayload: () => ({}),
      buildEndPayload: () => ({ sessionEnded: true }),
    };
    const { rerender } = renderHook((p) => useFitnessStateSync(p), {
      initialProps: props,
    });
    postMock.mockClear();
    rerender({ ...props, sessionActive: false });
    expect(postMock).toHaveBeenCalledWith(
      'api/v1/fitness/equipment_fan',
      expect.objectContaining({ sessionEnded: true }),
      'POST'
    );
  });

  test('fires a sendBeacon end-payload on unmount while session active', () => {
    const { unmount } = renderHook(() =>
      useFitnessStateSync({
        endpoint: 'api/v1/fitness/equipment_fan',
        enabled: true,
        sessionActive: true,
        buildSignature: () => 'x',
        buildPayload: () => ({}),
        buildEndPayload: () => ({ sessionEnded: true }),
      })
    );
    unmount();
    expect(beaconMock).toHaveBeenCalledTimes(1);
    const [, body] = beaconMock.mock.calls[0];
    expect(JSON.parse(body)).toMatchObject({ sessionEnded: true });
  });
});
