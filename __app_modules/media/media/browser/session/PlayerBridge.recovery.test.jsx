// RELY.7a / RELY.5a at the bridge: a restored session never mounts the
// Player until an explicit Play, and a terminal Player failure reaches the
// controller as a failure rather than as a normal end.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { PlayerHostProvider } from "./PlayerHostProvider.jsx";
import { LocalSessionContext } from "./LocalSessionContext.js";
import { createLocalSessionController } from "./LocalSessionController.js";
import { useMediaResilience } from '../../../../../__capabilities/playback/browser/player/hooks/useMediaResilience.js';
import { makeFakeEl } from '../../../../../__capabilities/playback/browser/player/hooks/__testHelpers/fakeMediaEl.js';
import { applyCommandEnvelope } from '../externalControl/commandHandler.js';
import mediaLog from "../logging/mediaLog.js";

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({ state: 'unreadable', steps: [] }) }));

vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

let latestProps = null;
const mounts = vi.fn();
vi.mock("../../../../../__capabilities/playback/browser/player/Player.jsx", () => ({
  default: React.forwardRef(function MockPlayer(props, ref) {
    latestProps = props;
    React.useImperativeHandle(ref, () => ({
      play: () => {}, pause: () => {}, seek: () => {}, getMediaElement: () => null,
      getMountedContentId: () => props.play?.contentId ?? null,
    }));
    React.useEffect(() => { mounts(props.play); }, []);
    return <audio data-testid="mock-player" />;
  }),
}));

const { PlayerBridge } = await import("./PlayerBridge.jsx");

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'audio', title, duration: 600, priority: 'queue', addedAt: '' });
const restored = {
  sessionId: 'old', state: 'playing', currentItem: { contentId: 'plex:1', format: 'audio', title: 'Arrival', duration: 600 },
  position: 321,
  queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova')], currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 40, playbackRate: 1 },
  meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
};

function mount(controller) {
  return render(
    <LocalSessionContext.Provider value={{ controller }}>
      <PlayerHostProvider><PlayerBridge /></PlayerHostProvider>
    </LocalSessionContext.Provider>,
  );
}

beforeEach(() => { latestProps = null; mounts.mockClear(); });

describe('PlayerBridge recovery', () => {
  it('does not mount the Player for a restored session until Play, then starts at the restored spot', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    const view = mount(controller);
    expect(view.queryByTestId('mock-player')).toBeNull();
    expect(mounts).not.toHaveBeenCalled();
    act(() => { controller.transport.play(); });
    expect(view.getByTestId('mock-player')).toBeInTheDocument();
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(mounts.mock.calls[0][0]).toEqual(expect.objectContaining({ contentId: 'plex:1', seconds: 321 }));
  });

  it('reports a terminal Player failure to the controller as a failure', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    mount(controller);
    act(() => { controller.transport.play(); });
    const spy = vi.spyOn(controller, 'onPlayerError');
    act(() => { latestProps.onResilienceEvent({ kind: 'resilience-exhausted', reason: 'stall', attempts: 3 }); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ code: 'resilience-exhausted' }));
    expect(controller.problems.get()).toEqual(expect.objectContaining({ kind: 'skipped', item: expect.objectContaining({ contentId: 'plex:1' }) }));
  });

  it('ignores a non-terminal media error that resilience may still recover, and passes no onError', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    mount(controller);
    act(() => { controller.transport.play(); });
    const spy = vi.spyOn(controller, 'onPlayerError');
    act(() => { latestProps.onResilienceEvent({ kind: 'media-error', code: 2 }); });
    expect(spy).not.toHaveBeenCalled();
    expect(latestProps.onError).toBeUndefined();
  });

  it('RELY.5a: gives the Player a 60 s refused-source limit and routes its wait reports to the controller', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    mount(controller);
    act(() => { controller.transport.play(); });
    expect(latestProps.mediaResilienceConfig).toEqual(expect.objectContaining({ monitor: expect.objectContaining({ sourceUnavailableMaxMs: 60_000 }) }));
    const wait = vi.spyOn(controller, 'onPlayerSourceWait');
    act(() => { latestProps.onResilienceEvent({ kind: 'source-wait', waiting: true, since: 1, contentId: 'plex:1' }); });
    expect(wait).toHaveBeenLastCalledWith(expect.objectContaining({ waiting: true, contentId: 'plex:1' }));
    act(() => { latestProps.onResilienceEvent({ kind: 'source-wait-ended', waiting: false, decision: 'resume', contentId: 'plex:1' }); });
    expect(wait).toHaveBeenLastCalledWith(expect.objectContaining({ waiting: false, decision: 'resume' }));
  });

  it('RELY.5a: a source give-up reaches the controller as source-unavailable-gave-up', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: structuredClone(restored) });
    mount(controller);
    act(() => { controller.transport.play(); });
    const spy = vi.spyOn(controller, 'onPlayerError');
    act(() => { latestProps.onResilienceEvent({ kind: 'resilience-exhausted', reason: 'source-unavailable-gave-up' }); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ code: 'source-unavailable-gave-up' }));
  });

  it('review nit: a give-up followed by the Player\'s own clear advances exactly once (repeat one)', () => {
    const one = structuredClone(restored);
    one.queue.items = [one.queue.items[0]];
    one.config.repeat = 'one';
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: one });
    mount(controller);
    act(() => { controller.transport.play(); });
    mediaLog.playbackAdvanced.mockClear();
    act(() => { latestProps.onResilienceEvent({ kind: 'resilience-exhausted', reason: 'stall' }); });
    // The same Player (same content) clears after the bridge has re-rendered.
    act(() => { latestProps.clear(); });
    expect(mediaLog.playbackAdvanced).toHaveBeenCalledTimes(1);
  });

  it('review nit: a give-up followed by clear advances exactly once when the next entry has the same content', () => {
    const dup = structuredClone(restored);
    dup.queue.items = [entry(1, 'Arrival'), { ...entry(1, 'Arrival'), queueItemId: 'q-1b' }, entry(2, 'Nova')];
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: dup });
    mount(controller);
    act(() => { controller.transport.play(); });
    act(() => { latestProps.onResilienceEvent({ kind: 'resilience-exhausted', reason: 'stall' }); });
    // The same Player (same content id) clears after the bridge re-rendered.
    act(() => { latestProps.clear(); });
    expect(controller.getSnapshot().queue.items[controller.getSnapshot().queue.currentIndex].queueItemId).toBe('q-1b');
  });

  it('re-verify 1: in the prod order the stale clear is consumed, and the next item\'s genuine end soon after still advances', () => {
    const three = structuredClone(restored);
    three.queue.items = [entry(1, 'Arrival'), entry(2, 'Nova'), entry(3, 'Dune')];
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: three });
    mount(controller);
    act(() => { controller.transport.play(); });
    // Prod order: the exhausted Player reports, the controller advances
    // (LOAD_ITEM bumps the generation synchronously), then the SAME call
    // stack runs the old visit's clear.
    const staleClear = latestProps.clear;
    act(() => {
      latestProps.onResilienceEvent({ kind: 'resilience-exhausted', reason: 'stall' });
      staleClear();
    });
    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:2');
    // B plays briefly and genuinely ends well inside the old 2 s window.
    act(() => { latestProps.onProgress({ currentTime: 590, paused: false }); });
    act(() => { latestProps.clear(); });
    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:3');
  });
});

const movieSnapshot = () => {
  const value = structuredClone(restored);
  value.currentItem.format = 'video';
  value.queue.items.forEach(item => { item.format = 'video'; });
  return value;
};

describe('held movie owner', () => {
  it('holdsRefusedMovieAfterMediaTimeout through the actual refused-source clock', async () => {
    vi.useFakeTimers();
    try {
      const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: movieSnapshot() });
      mount(controller);
      act(() => controller.transport.play());
      const before = controller.getSnapshot();
      const target = controller.recoveryIdentity.getTarget();
      const source = makeFakeEl({ currentTime: 321, duration: 600, paused: false });
      const hook = renderHook(() => useMediaResilience({
        meta: { contentId: 'plex:1', mediaType: 'video' }, getMediaEl: () => source,
        seconds: 321, waitKey: 'movie', playbackSessionKey: 'timeout-test',
        configOverrides: latestProps.mediaResilienceConfig,
        onSourceWait: event => latestProps.onResilienceEvent({ kind: event.waiting ? 'source-wait' : 'source-wait-ended', ...event }),
        onExhausted: event => latestProps.onResilienceEvent({ kind: 'resilience-exhausted', ...event }),
      }));
      await act(async () => { source.error = { code: 4, message: '503 Service Unavailable' }; source._fire('error'); });
      for (let tick = 0; tick < 64; tick++) await act(async () => { vi.advanceTimersByTime(1000); });
      expect(hook.result.current.overlayProps.isExhausted).toBe(true);
      const after = controller.getSnapshot();
      expect(after.currentItem.contentId).toBe(before.currentItem.contentId);
      expect(after.position).toBe(321);
      expect(after.queue).toEqual(before.queue);
      expect(controller.recoveryIdentity.getTarget()).toEqual(target);
      expect(controller.problems.get()).toMatchObject({ kind: 'waiting', reason: 'source-unavailable-gave-up' });
      hook.unmount();
    } finally { vi.useRealTimers(); }
  });
  it('does not interpret a held report or subsequent clear as completion', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: movieSnapshot() });
    mount(controller);
    act(() => controller.transport.play());
    const target = controller.recoveryIdentity.getTarget();
    act(() => latestProps.onResilienceEvent({ kind: 'resilience-held', reason: 'stall', attempts: 3, target, retryAfterMs: 12000 }));
    act(() => latestProps.clear());
    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:1');
    expect(controller.problems.get()).toMatchObject({ kind: 'waiting', reason: 'stall', retryAfterMs: 12000 });
  });
  it('remoteRetryPreservesPause and the queue visit through the browser command receiver', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: movieSnapshot() });
    const retried = [];
    controller.setPlayerHandle({ retryMediaResilience: () => { retried.push(controller.getSnapshot()); return { ok: true }; } });
    controller.transport.pause();
    controller.onPlayerError({ code: 'resilience-exhausted' });
    const target = controller.recoveryIdentity.getTarget();
    const response = applyCommandEnvelope(controller, { commandId: 'remote-retry', command: 'transport', params: { action: 'retry' }, origin: { kind: 'device', id: 'phone' }, ts: new Date().toISOString() });
    expect(response).toMatchObject({ ok: true });
    expect(retried).toHaveLength(1);
    expect(retried[0].state).toBe('paused');
    expect(retried[0].position).toBe(321);
    expect(controller.recoveryIdentity.getTarget().visitId).toBe(target.visitId);
    expect(controller.getSnapshot().queue.items).toHaveLength(2);
  });
  it('explicitSkipAdvancesOnce after failure, and the retired clear cannot advance again', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: movieSnapshot() });
    mount(controller); act(() => controller.transport.play());
    const oldClear = latestProps.clear;
    act(() => latestProps.onResilienceEvent({ kind: 'resilience-held', reason: 'stall', target: controller.recoveryIdentity.getTarget() }));
    act(() => controller.transport.skipNext());
    act(() => oldClear());
    expect(controller.getSnapshot().queue.currentIndex).toBe(1);
    expect(controller.getSnapshot().state).not.toBe('ended');
  });
  it('existing quality adoption remains usable while held and paused', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: movieSnapshot() });
    controller.transport.pause();
    controller.onPlayerError({ code: 'resilience-exhausted' });
    const target = controller.recoveryIdentity.getTarget();
    const outcome = controller.quality.setOverrides({ contentId: 'plex:1', quality: { maxResolution: '480' } });
    expect(outcome).toMatchObject({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({ state: 'paused', position: 321, currentItem: { contentId: 'plex:1', maxResolution: '480' } });
    expect(controller.recoveryIdentity.getTarget().visitId).toBe(target.visitId);
  });
});


describe('authoritative movie timeline in the Media owner', () => {
  it('keeps catalog end separate from observed native duration and holds timeline rejection without queue advance', () => {
    const snapshot = movieSnapshot();
    const timeline = { expectedEndSeconds: 5895, provenance: 'catalog', rendererStartSeconds: 0, contentStartSeconds: 0 };
    snapshot.currentItem.contentTimeline = timeline;
    snapshot.queue.items[0].contentTimeline = timeline;
    const controller = createLocalSessionController({ clientId: 'timeline-owner', persistedSnapshot: snapshot });
    mount(controller);
    act(() => controller.transport.play());
    expect(latestProps.play.contentTimeline).toMatchObject({ expectedEndSeconds: 5895 });
    act(() => latestProps.onProgress({ currentTime: 4370, duration: 4370, paused: false }));
    expect(controller.getSnapshot().currentItem.contentTimeline.expectedEndSeconds).toBe(5895);
    act(() => latestProps.onProgress({ currentTime: 50, contentSeconds: 4370, nativeSeconds: 50, duration: 60, paused: false }));
    expect(controller.position.get().seconds).toBe(4370);
    const before = controller.getSnapshot();
    act(() => latestProps.onResilienceEvent({ kind: 'resilience-held', reason: 'early-eof', attempts: 3,
      target: controller.recoveryIdentity.getTarget(), retryAfterMs: 0 }));
    expect(controller.getSnapshot().queue).toEqual(before.queue);
    expect(controller.getSnapshot().position).toBe(4370);
    expect(controller.problems.get()).toMatchObject({ kind: 'waiting', reason: 'early-eof' });
  });
});
