import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const stopFn = vi.fn();
const snapshotForHandoffFn = vi.fn(() => ({ sessionId: 's1', state: 'playing' }));
const localCtrl = {
  transport: { stop: stopFn, play: vi.fn(), pause: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
  queue: {}, config: {}, lifecycle: {},
  portability: { snapshotForHandoff: snapshotForHandoffFn, receiveClaim: vi.fn() },
  snapshot: {},
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => localCtrl),
}));

const dispatchToTarget = vi.fn(async () => ['d1']);
vi.mock('./useDispatch.js', () => ({
  useDispatch: vi.fn(() => ({ dispatches: new Map(), dispatchToTarget, retryLast: vi.fn() })),
}));

import { useHandOff } from './useHandOff.js';

beforeEach(() => {
  stopFn.mockClear();
  dispatchToTarget.mockClear();
  snapshotForHandoffFn.mockClear().mockReturnValue({ sessionId: 's1', state: 'playing' });
});

describe('useHandOff', () => {
  it('fires dispatchToTarget with adopt mode + snapshot', async () => {
    const { result } = renderHook(() => useHandOff());
    await act(async () => { await result.current('lr'); });
    expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetIds: ['lr'],
      mode: 'adopt',
      snapshot: expect.objectContaining({ sessionId: 's1' }),
    }));
  });

  it('stops local on mode=transfer (default)', async () => {
    const { result } = renderHook(() => useHandOff());
    await act(async () => { await result.current('lr'); });
    expect(stopFn).toHaveBeenCalled();
  });

  it('keeps local running on mode=fork', async () => {
    const { result } = renderHook(() => useHandOff());
    await act(async () => { await result.current('lr', { mode: 'fork' }); });
    expect(stopFn).not.toHaveBeenCalled();
  });

  it('returns {ok:false} if snapshotForHandoff returns null', async () => {
    snapshotForHandoffFn.mockReturnValueOnce(null);
    const { result } = renderHook(() => useHandOff());
    let outcome;
    await act(async () => { outcome = await result.current('lr'); });
    expect(outcome.ok).toBe(false);
    expect(dispatchToTarget).not.toHaveBeenCalled();
  });
});
