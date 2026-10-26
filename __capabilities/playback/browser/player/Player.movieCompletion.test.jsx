import React, { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Player from './Player.jsx';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { useCommonMediaController } from './hooks/useCommonMediaController.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from './lib/recoveryLedger.js';

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const full = { expectedEndSeconds: 5895, provenance: 'catalog', rendererStartSeconds: 0, contentStartSeconds: 0 };
let ledger;
beforeEach(() => {
  vi.useFakeTimers();
  DaylightAPI.mockReset();
  ledger = createRecoveryLedger();
  _setSharedLedgerForTests(ledger);
  useCommonMediaController.__appliedStartByKey = Object.create(null);
  useCommonMediaController.__lastPosByKey = Object.create(null);
  useCommonMediaController.__lastSeekByKey = Object.create(null);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); _setSharedLedgerForTests(null); vi.useRealTimers(); vi.restoreAllMocks(); });

async function mount({ timeline = full, segment, seconds = 4320, catalogDuration = 5895, repeat } = {}) {
  const resolved = { id: 'files:movie', assetId: 'files:movie', contentId: 'files:movie', title: 'Movie',
    mediaType: 'video', format: 'video', mediaUrl: '/movie.mp4?offset=4320', duration: catalogDuration,
    contentTimeline: timeline };
  DaylightAPI.mockImplementation(async path => String(path).includes('/queue/') ? { items: [resolved] } : String(path).includes('/play/') ? resolved : {});
  const completed = vi.fn();
  const held = vi.fn();
  const clear = vi.fn();
  const progress = vi.fn();
  const ref = createRef();
  let view;
  await act(async () => { view = render(<Player ref={ref}
    play={repeat ? [] : { ...resolved, seconds, segment }}
    onPlaybackCompleted={completed} onResilienceEvent={held} onProgress={progress} clear={clear} />); });
  if (repeat) await act(async () => ref.current.adoptSessionSnapshot({
    sessionId: 'movie-repeat', state: 'playing', currentItem: resolved, position: 0,
    queue: { items: [{ ...resolved, queueItemId: 'movie-visit' }], currentIndex: 0, upNextCount: 0, executionOrder: ['movie-visit'] },
    config: { shuffle: false, repeat, volume: 50, playbackRate: 1, shader: null },
    meta: { ownerId: 'test', updatedAt: '2026-10-26T00:00:00.000Z' },
  }, { autoplay: true }));
  const node = view.container.querySelector('video');
  expect(node).toBeTruthy();
  Object.defineProperties(node, {
    currentTime: { configurable: true, writable: true, value: seconds },
    duration: { configurable: true, writable: true, value: 4370 },
    readyState: { configurable: true, value: 4 },
    paused: { configurable: true, writable: true, value: false },
    ended: { configurable: true, writable: true, value: false },
    buffered: { configurable: true, value: { length: 1, start: () => 0, end: () => 4370 } },
  });
  act(() => node.dispatchEvent(new Event('loadedmetadata')));
  return { ...view, ref, node, completed, held, clear, progress };
}
const emit = (node, type, seconds) => act(() => {
  node.currentTime = seconds;
  if (type === 'ended') node.ended = true;
  node.dispatchEvent(new Event(type));
});

describe('movie terminal candidates through Player, SinglePlayer and native controller', () => {
  it('rejectsTruncatedNativeEndBeforeBookkeeping and reserves recovery despite native ended', async () => {
    const { ref, node, completed, clear, progress } = await mount();
    emit(node, 'timeupdate', 4370);
    emit(node, 'ended', 4370);
    expect(completed).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    emit(node, 'timeupdate', 4371);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ playing: true }));
    const target = ref.current.getRecoveryTarget();
    const session = ledger.snapshot(`${target.ownerId}:${target.visitId}`);
    expect(session.count).toBe(1);
  });
  it('deduplicatesValidTerminalSignals from native end and watchdog', async () => {
    const { node, completed } = await mount();
    node.duration = 5895;
    emit(node, 'timeupdate', 5895);
    emit(node, 'ended', 5895);
    act(() => vi.advanceTimersByTime(3100));
    emit(node, 'ended', 5895);
    expect(completed).toHaveBeenCalledTimes(1);
  });
  it('guardsWatchdogCompletion when the shortened native duration is reached', async () => {
    const { node, completed, clear } = await mount();
    emit(node, 'timeupdate', 4370);
    act(() => vi.advanceTimersByTime(3100));
    expect(completed).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(ledger.dumpAll().sessions.some(session => session.count === 1)).toBe(true);
  });
  it('honorsConfiguredClipEnd using raw native time rather than relative progress', async () => {
    const { node, completed } = await mount({ segment: { start: 4320, end: 4380 } });
    node.duration = 5895;
    emit(node, 'timeupdate', 4380);
    expect(completed).toHaveBeenCalledTimes(1);
    emit(node, 'ended', 4380);
    expect(completed).toHaveBeenCalledTimes(1);
  });
  it('holds a known catalog end when origins are unknown even if URL contains offset', async () => {
    const { node, completed, held, clear } = await mount({ timeline: { expectedEndSeconds: 5895, provenance: 'catalog' } });
    emit(node, 'ended', 4370);
    expect(completed).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(held).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resilience-held', reason: 'timeline-unverified' }));
  });
  it('keeps ordinary EOF with explicitly unverified evidence when catalog duration is absent', async () => {
    const { node, completed } = await mount({ timeline: {}, catalogDuration: null });
    emit(node, 'ended', 4370);
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ completion: 'completion-unverified' }));
  });
  it('maps relative native EOF and preserves catalog end across duration observations', async () => {
    const { node, ref, completed } = await mount({ seconds: 0,
      timeline: { ...full, contentStartSeconds: 4320 } });
    node.duration = 1575;
    emit(node, 'timeupdate', 1575);
    act(() => node.dispatchEvent(new Event('durationchange')));
    expect(ref.current.getNowPlaying().item.contentTimeline.expectedEndSeconds).toBe(5895);
    emit(node, 'ended', 1575);
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ completion: 'content-end' }));
  });
  it('reaches held state after repeated early EOF without advancing or renewing the visit budget', async () => {
    const { ref, container, completed, held, clear } = await mount();
    const visit = ref.current.getRecoveryTarget().visitId;
    for (let attempt = 0; attempt < 4; attempt++) {
      for (let tick = 0; tick < 20; tick++) await act(async () => { vi.advanceTimersByTime(1000); });
      const node = container.querySelector('video');
      expect(node).toBeTruthy();
      Object.defineProperties(node, {
        currentTime: { configurable: true, writable: true, value: 4370 },
        duration: { configurable: true, writable: true, value: 4370 },
        readyState: { configurable: true, value: 4 },
        ended: { configurable: true, writable: true, value: true },
        paused: { configurable: true, writable: true, value: false },
      });
      act(() => node.dispatchEvent(new Event('loadedmetadata')));
      emit(node, 'ended', 4370);
    }
    expect(completed).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(ref.current.getRecoveryTarget().visitId).toBe(visit);
    expect(held).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resilience-held', attempts: 3 }));
  });

  it('completes exactly once on each repeat-one visit despite duplicate native and watchdog signals', async () => {
    const { container, node, completed } = await mount({ repeat: 'one', seconds: 0 });
    const finish = current => {
      Object.defineProperties(current, {
        currentTime: { configurable: true, writable: true, value: 5895 },
        duration: { configurable: true, writable: true, value: 5895 },
        readyState: { configurable: true, value: 4 },
        ended: { configurable: true, writable: true, value: false },
        paused: { configurable: true, value: false },
      });
      emit(current, 'timeupdate', 5895);
      emit(current, 'ended', 5895);
      emit(current, 'ended', 5895);
    };
    await act(async () => finish(node));
    expect(completed).toHaveBeenCalledTimes(1);
    const second = container.querySelector('video');
    expect(second).not.toBe(node);
    emit(second, 'timeupdate', 0);
    emit(second, 'timeupdate', 1);
    await act(async () => finish(second));
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it('honors a clip end expressed in content seconds on a verified relative renderer', async () => {
    const { node, completed } = await mount({ seconds: 0, segment: { start: 4320, end: 4380 },
      timeline: { ...full, contentStartSeconds: 4320 } });
    node.duration = 1575;
    emit(node, 'timeupdate', 60);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown mapping held without background recovery until explicit Retry', async () => {
    const { node, ref, completed, held } = await mount({ timeline: { expectedEndSeconds: 5895, provenance: 'catalog' } });
    emit(node, 'timeupdate', 4370);
    emit(node, 'ended', 4370);
    const target = ref.current.getRecoveryTarget();
    for (let tick = 0; tick < 65; tick++) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(ref.current.getRecoveryTarget()).toEqual(target);
    expect(completed).not.toHaveBeenCalled();
    expect(held).toHaveBeenCalledTimes(1);
    expect((ledger.snapshot(`${target.ownerId}:${target.visitId}`)?.count ?? 0)).toBe(0);
    await act(async () => { expect(ref.current.retryMediaResilience(target).ok).toBe(true); });
    expect(ref.current.getRecoveryTarget().rendererGeneration).toBeGreaterThan(target.rendererGeneration);
  });

  it('reports authoritative progress and saves resume at 74.13 percent in hot and unmount logs', async () => {
    const { node, progress, unmount } = await mount();
    emit(node, 'timeupdate', 4370);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 4370, duration: 5895, percent: '74.1' }));
    expect(DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log').at(-1)[1])
      .toMatchObject({ seconds: 4370, percent: '74.1' });
    DaylightAPI.mockClear();
    unmount();
    expect(DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log').at(-1)[1])
      .toMatchObject({ seconds: 4370, percent: '74.1' });
  });
  it('maps relative native progress to original content seconds and uses clip duration for UI only', async () => {
    const { node, progress, unmount } = await mount({ seconds: 0,
      segment: { start: 4320, end: 4380 }, timeline: { ...full, contentStartSeconds: 4320 } });
    node.duration = 60;
    emit(node, 'timeupdate', 50);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 50, duration: 60, percent: '83.3' }));
    DaylightAPI.mockClear();
    unmount();
    expect(DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log').at(-1)[1])
      .toMatchObject({ seconds: 4370, percent: '74.1' });
  });
  it('does not publish a false confirmed position or watched log when known catalog mapping is unknown', async () => {
    const { node, progress, unmount } = await mount({ timeline: { expectedEndSeconds: 5895, provenance: 'catalog' } });
    emit(node, 'timeupdate', 4370);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: null, percent: null, duration: 5895 }));
    unmount();
    expect(DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log')).toHaveLength(0);
  });

});
