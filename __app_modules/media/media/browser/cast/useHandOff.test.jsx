import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { LocalSessionContext } from "../session/LocalSessionContext.js";

const dispatchToTarget = vi.fn();
const stopIfCurrent = vi.fn();
const capture = vi.fn(() => ({
  snapshot: { meta: { playbackOwner: { ownerInstanceId: 'source-owner', playbackRevision: 3 } } },
  identity: { ownerInstanceId: 'source-owner', playbackRevision: 3 },
}));
const adopt = vi.fn();
vi.mock("./useDispatch.js", () => ({ useDispatch: () => ({ dispatchToTarget }) }));
// The destination is the shared screen-move one (typed hand-off, else the
// adopt load for an idle screen): see screenMove.js.
const createScreenMoveDestination = vi.fn(() => ({ adopt }));
vi.mock("./screenMove.js", () => ({ createScreenMoveDestination: (...args) => createScreenMoveDestination(...args) }));
vi.mock("../logging/mediaLog.js", () => ({ default: new Proxy({}, { get: () => vi.fn() }) }));

import { useHandOff } from "./useHandOff.js";

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

  it('uses the shared screen-move destination (adopt-load fallback for an idle screen)', async () => {
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    stopIfCurrent.mockReturnValue({ ok: true });
    const { result } = renderHook(() => useHandOff(), { wrapper });
    await act(async () => { await result.current('livingroom-tv'); });
    expect(createScreenMoveDestination).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'livingroom-tv' }));
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

  it('starts the destination at an explicit start time when one is given (fling)', async () => {
    capture.mockReturnValueOnce({
      snapshot: { position: 612.4, meta: { playbackOwner: { ownerInstanceId: 'source-owner', playbackRevision: 3 } } },
      identity: { ownerInstanceId: 'source-owner', playbackRevision: 3 },
    });
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    stopIfCurrent.mockReturnValue({ ok: true });
    const { result } = renderHook(() => useHandOff(), { wrapper });
    await act(async () => { await result.current('office-tv', { startAt: 0 }); });
    expect(adopt.mock.calls[0][0].snapshot.position).toBe(0);
  });

  it('keeps the captured live position when no start time is given', async () => {
    capture.mockReturnValueOnce({
      snapshot: { position: 612.4, meta: { playbackOwner: { ownerInstanceId: 'source-owner', playbackRevision: 3 } } },
      identity: { ownerInstanceId: 'source-owner', playbackRevision: 3 },
    });
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    stopIfCurrent.mockReturnValue({ ok: true });
    const { result } = renderHook(() => useHandOff(), { wrapper });
    await act(async () => { await result.current('office-tv', { startAt: Number.NaN }); });
    expect(adopt.mock.calls[0][0].snapshot.position).toBe(612.4);
  });

  const pausedCapture = () => ({
    snapshot: {
      state: 'paused', position: 1234,
      currentItem: { contentId: 'plex:42', title: 'A Long Film' },
      queue: { items: [{ queueItemId: 'q1', contentId: 'plex:42' }, { queueItemId: 'q2', contentId: 'plex:43' }], currentIndex: 0 },
      meta: { playbackOwner: { ownerInstanceId: 'source-owner', playbackRevision: 3 } },
    },
    identity: { ownerInstanceId: 'source-owner', playbackRevision: 3 },
  });

  it('a fling (play: true) of a paused item sends a playing snapshot', async () => {
    capture.mockReturnValueOnce(pausedCapture());
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    stopIfCurrent.mockReturnValue({ ok: true });
    const { result } = renderHook(() => useHandOff(), { wrapper });
    await act(async () => { await result.current('office-tv', { startAt: 0, play: true }); });
    expect(adopt.mock.calls[0][0].snapshot.state).toBe('playing');
  });

  it('a plain move keeps a paused item paused (Move to... / Send to another device)', async () => {
    capture.mockReturnValueOnce(pausedCapture());
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    stopIfCurrent.mockReturnValue({ ok: true });
    const { result } = renderHook(() => useHandOff(), { wrapper });
    await act(async () => { await result.current('office-tv'); });
    const sent = adopt.mock.calls[0][0].snapshot;
    expect(sent.state).toBe('paused');
    expect(sent.position).toBe(1234);
    expect(sent.queue.items[0].resume).toBeUndefined();
  });

  it('an explicit start time is authoritative: the started item never takes the saved resume spot', async () => {
    capture.mockReturnValueOnce(pausedCapture());
    adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 7 });
    stopIfCurrent.mockReturnValue({ ok: true });
    const { result } = renderHook(() => useHandOff(), { wrapper });
    await act(async () => { await result.current('office-tv', { startAt: 0, play: true }); });
    const sent = adopt.mock.calls[0][0].snapshot;
    expect(sent.position).toBe(0);
    expect(sent.queue.items[0]).toMatchObject({ contentId: 'plex:42', resume: false });
    expect(sent.currentItem.resume).toBe(false);
    // Only the started item: what follows in the queue keeps its normal resume.
    expect(sent.queue.items[1].resume).toBeUndefined();
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
