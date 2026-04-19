import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...a) => apiMock(...a),
}));

const receiveClaimFn = vi.fn();
const localCtrl = {
  transport: { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
  queue: {}, config: {}, lifecycle: {},
  portability: { receiveClaim: receiveClaimFn, snapshotForHandoff: vi.fn() },
  snapshot: {},
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => localCtrl),
}));

vi.mock('../logging/mediaLog.js', () => ({
  default: {
    mounted: vi.fn(),
    unmounted: vi.fn(),
    sessionCreated: vi.fn(),
    sessionReset: vi.fn(),
    sessionResumed: vi.fn(),
    sessionStateChange: vi.fn(),
    sessionPersisted: vi.fn(),
    queueMutated: vi.fn(),
    playbackStarted: vi.fn(),
    playbackStalled: vi.fn(),
    playbackStallAutoAdvanced: vi.fn(),
    playbackError: vi.fn(),
    playbackAdvanced: vi.fn(),
    searchIssued: vi.fn(),
    searchResultChunk: vi.fn(),
    searchCompleted: vi.fn(),
    dispatchInitiated: vi.fn(),
    dispatchStep: vi.fn(),
    dispatchSucceeded: vi.fn(),
    dispatchFailed: vi.fn(),
    dispatchDeduplicated: vi.fn(),
    peekEntered: vi.fn(),
    peekExited: vi.fn(),
    peekCommand: vi.fn(),
    peekCommandAck: vi.fn(),
    takeoverInitiated: vi.fn(),
    takeoverSucceeded: vi.fn(),
    takeoverFailed: vi.fn(),
    takeoverDrift: vi.fn(),
    handoffInitiated: vi.fn(),
    handoffSucceeded: vi.fn(),
    handoffFailed: vi.fn(),
    wsConnected: vi.fn(),
    wsDisconnected: vi.fn(),
    wsReconnected: vi.fn(),
    wsStale: vi.fn(),
    externalControlReceived: vi.fn(),
    externalControlRejected: vi.fn(),
    urlCommandProcessed: vi.fn(),
    urlCommandIgnored: vi.fn(),
    transportCommand: vi.fn(),
  },
}));

import { useTakeOver } from './useTakeOver.js';
import mediaLog from '../logging/mediaLog.js';

// Shared mock adapter for drift-check tests
const mockSnapshot = { position: 0 };
const mockAdapter = {
  getSnapshot: vi.fn(() => mockSnapshot),
  subscribe: vi.fn(() => () => {}),
};
const Wrapper = ({ children }) => (
  <LocalSessionContext.Provider value={{ adapter: mockAdapter }}>
    {children}
  </LocalSessionContext.Provider>
);

beforeEach(() => {
  apiMock.mockReset();
  receiveClaimFn.mockClear();
  vi.clearAllMocks();
});

describe('useTakeOver', () => {
  it('POSTs to /session/claim with commandId', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, snapshot: { sessionId: 'claimed', state: 'paused' } });
    const { result } = renderHook(() => useTakeOver());
    let outcome;
    await act(async () => { outcome = await result.current('lr'); });
    expect(apiMock).toHaveBeenCalledWith(
      'api/v1/device/lr/session/claim',
      expect.objectContaining({ commandId: expect.any(String) }),
      'POST'
    );
    expect(outcome.ok).toBe(true);
  });

  it('calls portability.receiveClaim with the returned snapshot', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, snapshot: { sessionId: 'claimed' } });
    const { result } = renderHook(() => useTakeOver());
    await act(async () => { await result.current('lr'); });
    expect(receiveClaimFn).toHaveBeenCalledWith({ sessionId: 'claimed' });
  });

  it('returns {ok:false} when claim fails, does NOT call receiveClaim', async () => {
    apiMock.mockResolvedValueOnce({ ok: false, error: 'ATOMICITY_VIOLATION' });
    const { result } = renderHook(() => useTakeOver());
    let outcome;
    await act(async () => { outcome = await result.current('lr'); });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('ATOMICITY_VIOLATION');
    expect(receiveClaimFn).not.toHaveBeenCalled();
  });

  it('handles thrown errors gracefully', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useTakeOver());
    let outcome;
    await act(async () => { outcome = await result.current('lr'); });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('boom');
  });
});

describe('useTakeOver — position drift observability', () => {
  beforeEach(() => { vi.useFakeTimers(); mockSnapshot.position = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('logs takeover.drift when local position diverges >2s from expected', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, snapshot: {
      sessionId: 'r1', state: 'paused', currentItem: { contentId: 'p:1', format: 'video' },
      position: 120, queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'lr', updatedAt: '' },
    }});
    receiveClaimFn.mockImplementationOnce(() => {
      // Simulate the adapter adopting but landing at the wrong position
      mockSnapshot.position = 115;
    });

    const { result } = renderHook(() => useTakeOver(), { wrapper: Wrapper });
    await act(async () => { await result.current('lr'); });
    act(() => { vi.advanceTimersByTime(1600); });

    expect(mediaLog.takeoverDrift).toHaveBeenCalledTimes(1);
    const [payload] = mediaLog.takeoverDrift.mock.calls[0];
    expect(payload.deviceId).toBe('lr');
    // expected = 120 + 1.5 = 121.5. actual = 115. drift = 6.5
    expect(payload.driftSeconds).toBeGreaterThan(2);
  });

  it('does not log drift when within tolerance', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, snapshot: {
      sessionId: 'r1', state: 'paused', currentItem: { contentId: 'p:1', format: 'video' },
      position: 120, queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'lr', updatedAt: '' },
    }});
    receiveClaimFn.mockImplementationOnce(() => {
      // expected = 121.5; actual = 121.2; drift = 0.3 — well within tolerance
      mockSnapshot.position = 121.2;
    });

    const { result } = renderHook(() => useTakeOver(), { wrapper: Wrapper });
    await act(async () => { await result.current('lr'); });
    act(() => { vi.advanceTimersByTime(1600); });

    expect(mediaLog.takeoverDrift).not.toHaveBeenCalled();
  });
});
