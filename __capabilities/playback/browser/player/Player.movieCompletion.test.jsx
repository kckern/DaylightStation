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

async function mount({ timeline = full, segment, seconds = 4320, catalogDuration = 5895, repeat, format = 'video' } = {}) {
  const resolved = { id: 'files:movie', assetId: 'files:movie', contentId: 'files:movie', title: 'Movie',
    mediaType: format, format, mediaUrl: format === 'audio' ? '/track.mp3' : '/movie.mp4?offset=4320', duration: catalogDuration,
    ...(format === 'audio' ? {} : { contentTimeline: timeline }) };
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
  const node = ref.current.getMediaElement();
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

  it.each(['native-ended', 'clip-end', 'watchdog'])('accepts %s once after pause, resume and seek on the same renderer', async reason => {
    const { node, container, ref, completed, clear } = await mount({
      segment: reason === 'clip-end' ? { start: 4320, end: 4380 } : undefined,
    });
    const before = ref.current.getRecoveryTarget();
    await act(async () => ref.current.pause());
    await act(async () => ref.current.play());
    act(() => ref.current.seek(4330));
    expect(node.currentTime).toBe(4330);
    act(() => { node.dispatchEvent(new Event('seeking')); node.dispatchEvent(new Event('seeked')); });
    expect(container.querySelector('video')).toBe(node);
    expect(ref.current.getRecoveryTarget().visitId).toBe(before.visitId);
    expect(ref.current.getRecoveryTarget().intentRevision).toBeGreaterThan(before.intentRevision);
    node.duration = 5895;
    const end = reason === 'clip-end' ? 4380 : 5895;
    if (reason === 'native-ended') emit(node, 'ended', end);
    else emit(node, 'timeupdate', end);
    if (reason === 'watchdog') act(() => vi.advanceTimersByTime(3100));
    expect(completed).toHaveBeenCalledTimes(1);
    emit(node, 'ended', end);
    act(() => vi.advanceTimersByTime(3100));
    expect(completed).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(ledger.dumpAll().sessions.every(session => session.count === 0)).toBe(true);
  });

  it('does not bless a superseded same-node renderer claim when later controls change intent', async () => {
    const { node, ref, completed } = await mount();
    const identity = ref.current.getRecoveryIdentity();
    act(() => identity.beginRenderer(identity.getTarget()));
    await act(async () => ref.current.pause());
    await act(async () => ref.current.play());
    node.duration = 5895;
    emit(node, 'ended', 5895);
    expect(completed).not.toHaveBeenCalled();
    expect(ledger.dumpAll().sessions.every(session => session.count === 0)).toBe(true);
  });

  it('ignores queued old-node EOF while same-visit replacement is pending and after newer intent', async () => {
    const listeners = vi.spyOn(HTMLMediaElement.prototype, 'addEventListener');
    const { node, container, ref, completed } = await mount();
    const oldEnded = listeners.mock.calls.flatMap(([type, listener], index) =>
      type === 'ended' && listeners.mock.contexts[index] === node ? [listener] : []).at(-1);
    expect(oldEnded).toBeTypeOf('function');
    const visitId = ref.current.getRecoveryTarget().visitId;
    const resolved = ref.current.getNowPlaying().item;
    let resolveMedia;
    const pending = new Promise(resolve => { resolveMedia = resolve; });
    const api = DaylightAPI.getMockImplementation();
    DaylightAPI.mockImplementation((path, ...args) => String(path).includes('/play/') && !String(path).includes('/play/log')
      ? pending : api(path, ...args));
    await act(async () => ref.current.beginRendererBoundary({ operationId: 'terminal-replacement',
      expectedContentId: 'files:movie', targetSeconds: 4330, autoplay: false }));
    expect(container.querySelector('video')).toBeNull();
    expect(ref.current.getRecoveryTarget().visitId).toBe(visitId);
    await act(async () => ref.current.pause());
    await act(async () => ref.current.play());
    node.currentTime = 5895;
    act(() => oldEnded(new Event('ended')));
    expect(completed).not.toHaveBeenCalled();
    await act(async () => resolveMedia(resolved));
    expect(container.querySelector('video')).not.toBe(node);
    act(() => oldEnded(new Event('ended')));
    expect(completed).not.toHaveBeenCalled();
    expect(ledger.dumpAll().sessions.every(session => session.count === 0)).toBe(true);
  });

  it('keeps queued native EOF superseded by Stop from completing or spending recovery', async () => {
    const { node, ref, completed } = await mount();
    act(() => ref.current.stop());
    expect(node.currentTime).toBe(0);
    emit(node, 'ended', 0);
    expect(completed).not.toHaveBeenCalled();
    expect(ledger.dumpAll().sessions.every(session => session.count === 0)).toBe(true);
  });

  it.each([
    ['audio', false], ['audio', true], ['video', false], ['video', true],
  ])('starts a fresh %s visit after Stop→Play and completes its clip=%s exactly once', async (format, clip) => {
    const listeners = vi.spyOn(HTMLMediaElement.prototype, 'addEventListener');
    const segment = clip ? { start: 10, end: 20 } : undefined;
    const { node, ref, completed, clear } = await mount({ format, segment,
      seconds: clip ? 10 : 0, catalogDuration: 100, timeline: { ...full, expectedEndSeconds: 100 } });
    const oldEnded = listeners.mock.calls.flatMap(([type, listener], index) =>
      type === 'ended' && listeners.mock.contexts[index] === node ? [listener] : []).at(-1);
    expect(oldEnded).toBeTypeOf('function');
    expect(ref.current.getMountedMediaRegistration()?.node).toBe(node);
    const before = ref.current.getRecoveryTarget();
    const queue = ref.current.getQueueSnapshot();
    act(() => ref.current.stop());
    expect(node.currentTime).toBe(0);
    await act(async () => ref.current.play());
    const fresh = ref.current.getMediaElement();
    expect(fresh).toBeTruthy();
    expect(ref.current.getRecoveryTarget().visitId).not.toBe(before.visitId);
    // This queued signal belongs to the visit Stop superseded, even though
    // the current content id and later Play intent are unchanged.
    node.currentTime = 100;
    act(() => oldEnded(new Event('ended')));
    expect(completed).not.toHaveBeenCalled();
    Object.defineProperties(fresh, {
      currentTime: { configurable: true, writable: true, value: 0 },
      duration: { configurable: true, value: 100 },
      readyState: { configurable: true, value: 4 },
      paused: { configurable: true, writable: true, value: false },
      ended: { configurable: true, writable: true, value: false },
    });
    act(() => { fresh.dispatchEvent(new Event('durationchange')); fresh.dispatchEvent(new Event('loadedmetadata')); });
    expect(fresh.currentTime).toBe(clip ? 10 : 0);
    if (clip) {
      act(() => { fresh.dispatchEvent(new Event('seeking')); fresh.dispatchEvent(new Event('seeked')); });
      emit(fresh, 'timeupdate', 20);
    } else emit(fresh, 'ended', 100);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(fresh).not.toBe(node);
    expect(ref.current.getQueueSnapshot()).toEqual(queue);
    emit(fresh, 'ended', clip ? 20 : 100);
    act(() => oldEnded(new Event('ended')));
    expect(completed).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(ledger.dumpAll().sessions.every(session => session.count === 0)).toBe(true);
  });

});
