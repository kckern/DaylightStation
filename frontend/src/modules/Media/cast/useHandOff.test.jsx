import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';

const dispatchToTarget = vi.fn();
const stopIfCurrent = vi.fn();
const capture = vi.fn(() => ({
  snapshot: { meta: { playbackOwner: { ownerInstanceId: 'source-owner', playbackRevision: 3 } } },
  identity: { ownerInstanceId: 'source-owner', playbackRevision: 3 },
}));
const adopt = vi.fn();
vi.mock('./useDispatch.js', () => ({ useDispatch: () => ({ dispatchToTarget }) }));
vi.mock('./remoteMoveDestination.js', () => ({
  createRemoteMoveDestination: () => ({ adopt }),
}));
vi.mock('../logging/mediaLog.js', () => ({ default: new Proxy({}, { get: () => vi.fn() }) }));

import { useHandOff } from './useHandOff.js';

const controller = { portability: { capture, stopIfCurrent, snapshotForHandoff: () => ({ sessionId: 's1' }) } };
const wrapper = ({ children }) => (
  <LocalSessionContext.Provider value={{ controller }}>{children}</LocalSessionContext.Provider>
);

describe('useHandOff failure-safe transfer', () => {
  beforeEach(() => vi.clearAllMocks());
  it('moves through destination evidence and stops the unchanged source', async () => {
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    stopIfCurrent.mockReturnValue({ ok: true });
    const { result } = renderHook(() => useHandOff(), { wrapper });

    let outcome;
    await act(async () => { outcome = await result.current('livingroom-tv'); });

    expect(outcome).toMatchObject({ ok: true, status: 'adopted', sourceStopped: true });
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ destinationId: 'livingroom-tv', keepSource: false }));
    expect(stopIfCurrent).toHaveBeenCalled();
    expect(dispatchToTarget).not.toHaveBeenCalled();
  });

  it('does not stop when destination adoption is rejected', async () => {
    adopt.mockResolvedValue({ status: 'rejected', reason: 'HANDOFF_UNSUPPORTED' });
    const { result } = renderHook(() => useHandOff(), { wrapper });
    let outcome;
    await act(async () => { outcome = await result.current('livingroom-tv'); });
    expect(outcome).toMatchObject({ ok: false, status: 'rejected', error: 'HANDOFF_UNSUPPORTED' });
    expect(stopIfCurrent).not.toHaveBeenCalled();
  });

  it('does not report a move as complete when the source changed before stop', async () => {
    capture
      .mockReturnValueOnce({
        snapshot: { meta: { playbackOwner: { ownerInstanceId: 'source-owner', playbackRevision: 3 } } },
        identity: { ownerInstanceId: 'source-owner', playbackRevision: 3 },
      })
      .mockReturnValue({
        snapshot: { meta: { playbackOwner: { ownerInstanceId: 'source-owner', playbackRevision: 4 } } },
        identity: { ownerInstanceId: 'source-owner', playbackRevision: 4 },
      });
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    const { result } = renderHook(() => useHandOff(), { wrapper });

    let outcome;
    await act(async () => { outcome = await result.current('livingroom-tv'); });

    expect(outcome).toMatchObject({ ok: false, status: 'adopted', sourceStopped: false, error: 'source-changed' });
    expect(stopIfCurrent).not.toHaveBeenCalled();
  });

  it('keeps an explicitly non-destructive fork available', async () => {
    dispatchToTarget.mockResolvedValue(['dispatch-1']);
    const { result } = renderHook(() => useHandOff(), { wrapper });

    let outcome;
    await act(async () => { outcome = await result.current('livingroom-tv', { mode: 'fork' }); });

    expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fork' }));
    expect(outcome).toEqual({ ok: true, dispatchIds: ['dispatch-1'] });
  });
});
