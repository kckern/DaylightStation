import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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

import { useTakeOver } from './useTakeOver.js';

beforeEach(() => {
  apiMock.mockReset();
  receiveClaimFn.mockClear();
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
