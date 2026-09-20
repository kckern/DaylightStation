import React, { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ items: [], audio: null })),
}));

// Keep a play-next request as an on-deck entry so this wiring test exercises
// the insertion boundary instead of the Player's short-start preemption path.
vi.mock('./hooks/usePlayerConfig.js', () => ({
  usePlayerConfig: () => ({ onDeck: { preempt_seconds: 0, displace_to_queue: false } }),
}));

let mockMediaElement = null;
let latestSinglePlayerProps = null;
vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: (props) => {
    const { onRegisterMediaAccess } = props;
    latestSinglePlayerProps = props;
    React.useEffect(() => {
      // Manual-registration cases own this boundary themselves. Automatic
      // cases model the mounted node rather than a mutable global accessor.
      const node = mockMediaElement;
      if (node) onRegisterMediaAccess?.({ getMediaEl: () => node });
    }, [onRegisterMediaAccess, mockMediaElement]);
    return <div data-testid="single-player" />;
  },
}));

import Player from './Player.jsx';
import { createPlayerSessionBridge } from '../../screen-framework/publishers/playerSessionBridge.js';
import { createPlayerSessionRegistry } from '../../screen-framework/publishers/playerSessionRegistry.js';
import { createRegistrySessionSource } from '../../screen-framework/publishers/registrySessionSource.js';
import { __resetPlayerQueueOpRegistryForTests, getPlayerQueueOpRegistry } from './lib/queueOpRegistry.js';
import { DaylightAPI } from '../../lib/api.mjs';

afterEach(() => {
  cleanup();
  __resetPlayerQueueOpRegistryForTests();
  mockMediaElement = null;
  latestSinglePlayerProps = null;
});

describe('Player session port', () => {
  const adoptionSnapshot = ({
    items, executionOrder, repeat = 'off', playbackRate = 1, shader = null,
  }) => ({
    sessionId: 'adoption-session', state: 'paused',
    currentItem: { contentId: items[0].contentId, format: items[0].format ?? 'video', title: items[0].title },
    position: 0,
    queue: { items, currentIndex: 0, upNextCount: items.filter((item) => item.priority === 'upNext').length, executionOrder },
    config: { shuffle: false, repeat, shader, volume: 50, playbackRate },
    meta: { ownerId: 'source', updatedAt: '2026-09-14T00:00:00.000Z' },
  });

  it('admits a direct play into the owner before native playback is observed', async () => {
    const ref = createRef();
    const native = document.createElement('video');
    Object.defineProperty(native, 'paused', { configurable: true, value: false });
    Object.defineProperty(native, 'currentTime', { configurable: true, value: 1 });
    mockMediaElement = native;
    let resolveQueue;
    DaylightAPI.mockImplementation((path) => {
      if (String(path).startsWith('api/v1/queue/plex:direct')) {
        return new Promise((resolve) => { resolveQueue = resolve; });
      }
      return Promise.resolve({ contentId: 'plex:direct', title: 'Direct', mediaUrl: '/stream/direct', format: 'video' });
    });

    const view = render(<Player ref={ref} play={{ contentId: 'plex:direct', title: 'Direct', format: 'video' }} />);
    await waitFor(() => expect(latestSinglePlayerProps).toBeTruthy());
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));
    expect(ref.current.getQueueSnapshot().items[0]).toMatchObject({ contentId: 'plex:direct' });
    const admittedIdentity = ref.current.getPlaybackIdentity();
    expect(admittedIdentity.playbackRevision).toBeGreaterThan(0);
    view.rerender(<Player ref={ref} play={{ contentId: 'plex:direct', title: 'Direct', format: 'video' }} />);
    expect(ref.current.getPlaybackIdentity()).toEqual(admittedIdentity);

    let tick = null;
    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({
      getPlayerHandle: () => ref.current,
      registry,
      setIntervalFn: (fn) => { tick = fn; return 1; },
      clearIntervalFn: () => {},
    });
    bridge.start();
    act(() => {
      latestSinglePlayerProps.onMediaRef(native, { contentId: 'plex:direct' });
      tick();
      native.dispatchEvent(new Event('playing'));
      tick();
    });
    const source = createRegistrySessionSource({ registry, ownerId: 'screen', sessionId: 'direct-session' });
    expect(source.getSnapshot()).toMatchObject({
      state: 'playing',
      currentItem: { contentId: 'plex:direct' },
      queue: { currentIndex: 0 },
    });
    expect(source.capture().identity.playbackRevision).toBeGreaterThan(0);
    bridge.stop();
    await act(async () => resolveQueue({ items: [{ contentId: 'plex:direct', title: 'Canonical', format: 'hls_video' }], audio: null }));
    await waitFor(() => expect(ref.current.getQueueSnapshot().items).toHaveLength(1));
    await waitFor(() => expect(ref.current.getQueueSnapshot().items[0]).toMatchObject({
      contentId: 'plex:direct', title: 'Canonical', format: 'hls_video',
    }));
    expect(ref.current.getMediaElement()).toBe(native);
    expect(ref.current.getPlaybackIdentity().playbackRevision).toBeGreaterThanOrEqual(admittedIdentity.playbackRevision);
  });

  it('adopts an exact [A,B,A] owner capture into the existing destination Player', async () => {
    const sourceRef = createRef();
    const destinationRef = createRef();
    const view = render(<>
      <Player ref={destinationRef} play={[]} />
      <Player ref={sourceRef} play={[
        { contentId: 'plex:a', title: 'A', format: 'video' },
        { contentId: 'plex:b', title: 'B', format: 'video' },
        { contentId: 'plex:a', title: 'A again', format: 'video' },
      ]} shuffle />
    </>);
    await waitFor(() => expect(sourceRef.current?.getQueueSnapshot()?.items).toHaveLength(3));
    await waitFor(() => expect(destinationRef.current).toBeTruthy());

    act(() => {
      sourceRef.current.advance();
      sourceRef.current.advance();
      sourceRef.current.setVolume(0.73);
      sourceRef.current.setPlaybackRate(1.25);
    });
    await waitFor(() => expect(sourceRef.current.getQueueSnapshot().currentIndex).toBe(2));
    await act(async () => {
      await getPlayerQueueOpRegistry().dispatch({ op: 'play-next', contentId: 'plex:next', shader: 'night' });
    });
    await waitFor(() => expect(sourceRef.current.getQueueSnapshot().items).toHaveLength(4));

    const sourceRegistry = createPlayerSessionRegistry();
    const destinationRegistry = createPlayerSessionRegistry();
    const sourceBridge = createPlayerSessionBridge({ getPlayerHandle: () => sourceRef.current, registry: sourceRegistry, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const destinationBridge = createPlayerSessionBridge({ getPlayerHandle: () => destinationRef.current, registry: destinationRegistry, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    sourceBridge.start();
    destinationBridge.start();
    const source = createRegistrySessionSource({ registry: sourceRegistry, ownerId: 'source-screen', sessionId: 'source-session' });
    const destination = createRegistrySessionSource({ registry: destinationRegistry, ownerId: 'destination-screen', sessionId: 'destination-session' });
    const detached = source.capture();
    const sourceOwnerId = detached.identity.ownerInstanceId;
    detached.snapshot.config.repeat = 'one';
    const before = destination.capture().identity;

    const malformed = structuredClone(detached.snapshot);
    malformed.queue.executionOrder = ['missing-entry'];
    expect(destination.adopt(malformed, { autoplay: false, transferId: 'transfer-player-bad' }))
      .toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });
    expect(destinationRef.current.getQueueSnapshot().items).toHaveLength(0);
    expect(destination.capture().identity).toEqual(before);
    const wrongCurrent = structuredClone(detached.snapshot);
    wrongCurrent.currentItem = { contentId: 'plex:wrong', format: 'video' };
    expect(destination.adopt(wrongCurrent, { autoplay: false })).toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });
    const missingSession = structuredClone(detached.snapshot);
    delete missingSession.meta.playbackOwner;
    delete missingSession.sessionId;
    expect(destination.adopt(missingSession, { autoplay: false })).toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });

    expect(destination.adopt(detached.snapshot, { autoplay: false, transferId: 'transfer-player-1' })).toEqual({ ok: true });
    await waitFor(() => expect(destinationRef.current.getQueueSnapshot().items).toHaveLength(4));
    const adopted = destination.capture();

    expect(adopted.snapshot.queue).toEqual(detached.snapshot.queue);
    expect(adopted.snapshot.config).toEqual(detached.snapshot.config);
    expect(adopted.snapshot.queue.items.map((item) => item.contentId)).toEqual(['plex:a', 'plex:b', 'plex:a', 'plex:next']);
    expect(adopted.snapshot.queue.currentIndex).toBe(2);
    expect(adopted.snapshot.queue.executionOrder).toEqual(detached.snapshot.queue.executionOrder);
    expect(adopted.identity.ownerInstanceId).toBe(destinationRef.current.getPlayerInstanceId());
    expect(adopted.identity.playbackRevision).toBeGreaterThan(before.playbackRevision);
    expect(adopted.identity.queueRevision).toBeGreaterThan(before.queueRevision);
    expect(adopted.capabilities.handoffV1).toBe(false);
    expect(source.capture().identity.ownerInstanceId).toBe(sourceOwnerId);
    expect(adopted.identity.ownerInstanceId).toBe(before.ownerInstanceId);
    expect(view.getAllByTestId('single-player')).toHaveLength(2);
    sourceBridge.stop();
    destinationBridge.stop();
  });

  it('revokes an in-flight queue initialization before committing adoption', async () => {
    let resolvePending;
    DaylightAPI.mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));
    const ref = createRef();
    render(<Player ref={ref} play={{ contentId: 'plex:pending-review' }} />);
    await waitFor(() => expect(resolvePending).toEqual(expect.any(Function)));
    const adopted = adoptionSnapshot({
      items: [
        { queueItemId: 'adopt-a', contentId: 'plex:adopt-a', title: 'Adopt A', format: 'video', priority: 'queue' },
        { queueItemId: 'adopt-b', contentId: 'plex:adopt-b', title: 'Adopt B', format: 'video', priority: 'queue' },
      ],
      executionOrder: ['adopt-a', 'adopt-b'],
    });
    expect(ref.current.adoptSessionSnapshot(adopted, { autoplay: false })).toEqual({ ok: true });
    await waitFor(() => expect(ref.current.getQueueSnapshot().items.map((item) => item.contentId))
      .toEqual(['plex:adopt-a', 'plex:adopt-b']));

    resolvePending({ items: [{ contentId: 'plex:old-result', title: 'Old', format: 'video' }], audio: null });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(ref.current.getQueueSnapshot().items.map((item) => item.contentId))
      .toEqual(['plex:adopt-a', 'plex:adopt-b']);
  });

  it.each(['empty', 'error'])('revokes stale %s queue initialization side effects after adoption', async (mode) => {
    let settlePending;
    DaylightAPI.mockImplementationOnce(() => new Promise((resolve, reject) => {
      settlePending = mode === 'empty'
        ? () => resolve({ items: [], audio: null })
        : () => reject(new Error('stale queue failure'));
    }));
    const clear = vi.fn();
    const onError = vi.fn();
    const ref = createRef();
    render(<Player ref={ref} play={{ contentId: `plex:pending-${mode}` }} clear={clear} onError={onError} />);
    await waitFor(() => expect(settlePending).toEqual(expect.any(Function)));
    const adopted = adoptionSnapshot({
      items: [{ queueItemId: 'kept', contentId: 'plex:kept', format: 'video', priority: 'queue' }],
      executionOrder: ['kept'],
    });
    expect(ref.current.adoptSessionSnapshot(adopted, { autoplay: false })).toEqual({ ok: true });
    await waitFor(() => expect(ref.current.getQueueSnapshot().items[0]?.queueItemId).toBe('kept'));

    settlePending();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(ref.current.getQueueSnapshot().items[0]?.queueItemId).toBe('kept');
    expect(clear).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('preserves explicit execution order when a later visit retains upNext priority', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[]} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    const adopted = adoptionSnapshot({
      items: [
        { queueItemId: 'a', contentId: 'plex:a', format: 'video', priority: 'queue' },
        { queueItemId: 'b', contentId: 'plex:b', format: 'video', priority: 'queue' },
        { queueItemId: 'c', contentId: 'plex:c', format: 'video', priority: 'upNext' },
      ],
      executionOrder: ['a', 'b', 'c'],
    });
    expect(ref.current.adoptSessionSnapshot(adopted, { autoplay: false })).toEqual({ ok: true });
    await waitFor(() => expect(ref.current.getQueueSnapshot().executionOrder).toEqual(['a', 'b', 'c']));
    act(() => ref.current.advance());
    await waitFor(() => expect(ref.current.getQueueSnapshot().items[ref.current.getQueueSnapshot().currentIndex].queueItemId).toBe('b'));
  });

  it('executes repeated adopted visits through the real legacy queue owner', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[]} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    const adopted = adoptionSnapshot({
      items: [
        { queueItemId: 'a', contentId: 'plex:a', format: 'video', priority: 'queue' },
        { queueItemId: 'b', contentId: 'plex:b', format: 'video', priority: 'queue' },
        { queueItemId: 'c', contentId: 'plex:c', format: 'video', priority: 'queue' },
      ],
      executionOrder: ['a', 'c', 'a', 'b'],
    });
    expect(ref.current.adoptSessionSnapshot(adopted, { autoplay: false })).toEqual({ ok: true });
    for (const expected of ['c', 'a', 'b']) {
      act(() => ref.current.advance());
      await waitFor(() => expect(
        ref.current.getQueueSnapshot().items[ref.current.getQueueSnapshot().currentIndex].queueItemId,
      ).toBe(expected));
    }
  });

  it('applies adopted rate and shader through the production Player renderer props', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[]} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    const adopted = adoptionSnapshot({
      items: [{ queueItemId: 'rate-config-a', contentId: 'plex:rate-config', format: 'video', priority: 'queue' }],
      executionOrder: ['rate-config-a'], playbackRate: 1.25, shader: 'night',
    });
    expect(ref.current.adoptSessionSnapshot(adopted, { autoplay: false })).toEqual({ ok: true });
    await waitFor(() => expect(latestSinglePlayerProps).toMatchObject({
      playbackRate: 1.25, shader: 'night', volume: 0.5,
    }));
    expect(ref.current.getPlaybackRate()).toBe(1.25);
    expect(ref.current.getShader()).toBe('night');
  });

  it('repeats adopted repeat-one on natural completion but manual Skip still advances', async () => {
    const node = document.createElement('video');
    Object.defineProperties(node, {
      currentTime: { configurable: true, writable: true, value: 18 },
      play: { configurable: true, value: vi.fn(() => Promise.resolve()) },
    });
    mockMediaElement = node;
    const ref = createRef();
    render(<Player ref={ref} play={[]} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    const adopted = adoptionSnapshot({
      items: [
        { queueItemId: 'a', contentId: 'plex:a', format: 'video', priority: 'queue' },
        { queueItemId: 'b', contentId: 'plex:b', format: 'video', priority: 'queue' },
      ],
      executionOrder: ['a', 'b'], repeat: 'one',
    });
    act(() => ref.current.adoptSessionSnapshot(adopted, { autoplay: false }));
    await waitFor(() => expect(ref.current.getQueueConfig()).toMatchObject({ repeat: 'one' }));
    await waitFor(() => expect(ref.current.getQueueSnapshot().executionOrder).toEqual(['a', 'b']));
    act(() => latestSinglePlayerProps.advance());
    expect(ref.current.getQueueSnapshot().items[ref.current.getQueueSnapshot().currentIndex].queueItemId).toBe('a');
    expect(node.currentTime).toBe(18);
    expect(node.play).not.toHaveBeenCalled();
    expect(latestSinglePlayerProps.remountDiagnostics.rendererOperation).toMatchObject({ targetSeconds: 0, autoplay: true });
    act(() => latestSinglePlayerProps.advance());
    expect(node.play).not.toHaveBeenCalled();
    act(() => latestSinglePlayerProps.onPlaybackMetrics({ seconds: 0, isPaused: false }));
    act(() => latestSinglePlayerProps.onPlaybackMetrics({ seconds: 1, isPaused: false }));
    act(() => latestSinglePlayerProps.advance());
    expect(ref.current.getQueueSnapshot().items[ref.current.getQueueSnapshot().currentIndex].queueItemId).toBe('a');
    expect(node.play).not.toHaveBeenCalled();
    act(() => latestSinglePlayerProps.advance());
    expect(node.play).not.toHaveBeenCalled();
    act(() => ref.current.advance());
    await waitFor(() => expect(ref.current.getQueueSnapshot().items[ref.current.getQueueSnapshot().currentIndex].queueItemId).toBe('b'));
  });

  it('loops a single adopted repeat-all entry across laps and suppresses duplicate terminals', async () => {
    // Break caught: the legacy queue owner clears a one-entry repeat-all plan,
    // and merely retaining it would still leave the ended decoder at its end.
    const node = document.createElement('video');
    const play = vi.fn()
      .mockRejectedValueOnce(new Error('autoplay rejected'))
      .mockResolvedValue(undefined);
    Object.defineProperties(node, {
      currentTime: { configurable: true, writable: true, value: 18 },
      play: { configurable: true, value: play },
    });
    mockMediaElement = node;
    const clear = vi.fn();
    const ref = createRef();
    render(<Player ref={ref} play={[]} clear={clear} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    act(() => ref.current.adoptSessionSnapshot(adoptionSnapshot({
      items: [{ queueItemId: 'only', contentId: 'plex:only', format: 'video', priority: 'queue' }],
      executionOrder: ['only'], repeat: 'all',
    }), { autoplay: false }));
    await waitFor(() => expect(ref.current.getQueueConfig()).toMatchObject({ repeat: 'all' }));
    await waitFor(() => expect(ref.current.getQueueSnapshot().executionOrder).toEqual(['only']));
    const seek = vi.fn(() => {
      node.currentTime = 0;
      return Promise.reject(new Error('seek acknowledgement rejected'));
    });
    act(() => latestSinglePlayerProps.onController({
      transport: { getMediaEl: () => node, seek, play },
    }));
    act(() => latestSinglePlayerProps.onMediaRef(node, { contentId: 'plex:only' }));
    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({
      getPlayerHandle: () => ref.current,
      registry,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
    bridge.start();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen', sessionId: 'repeat-all-native' });
    expect(source.getNativeObservation().identity).not.toBeNull();

    await act(async () => {
      latestSinglePlayerProps.advance();
      await Promise.resolve();
    });
    expect(ref.current.getQueueSnapshot()).toMatchObject({ currentIndex: 0, executionOrder: ['only'] });
    expect(clear).not.toHaveBeenCalled();
    expect(node.currentTime).toBe(18);
    expect(seek).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    // The retired same node is never reused as proof while the fresh renderer
    // operation is still unresolved by this deliberately minimal fixture.
    expect(source.getNativeObservation()).toMatchObject({
      identity: null,
      playingObserved: false,
      advancedObserved: false,
    });
    act(() => latestSinglePlayerProps.advance());
    expect(play).not.toHaveBeenCalled();

    act(() => latestSinglePlayerProps.onPlaybackMetrics({ seconds: 0, isPaused: false }));
    act(() => latestSinglePlayerProps.onPlaybackMetrics({ seconds: 1, isPaused: false }));
    node.currentTime = 18;
    act(() => latestSinglePlayerProps.advance());
    expect(ref.current.getQueueSnapshot()).toMatchObject({ currentIndex: 0, executionOrder: ['only'] });
    expect(node.currentTime).toBe(18);
    expect(seek).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    act(() => latestSinglePlayerProps.advance());
    expect(play).not.toHaveBeenCalled();
    bridge.stop();
  });

  it('replays a consecutive [A,A,B] visit before advancing the logical plan to B', async () => {
    // Break caught: consuming a repeated reference changes executionOrder but
    // not the renderer input, so the ended native node never starts visit two.
    const node = document.createElement('video');
    const play = vi.fn(() => Promise.resolve());
    Object.defineProperties(node, {
      currentTime: { configurable: true, writable: true, value: 18 },
      play: { configurable: true, value: play },
    });
    mockMediaElement = node;
    const ref = createRef();
    render(<Player ref={ref} play={[]} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    act(() => ref.current.adoptSessionSnapshot(adoptionSnapshot({
      items: [
        { queueItemId: 'a', contentId: 'plex:a', format: 'video', priority: 'queue' },
        { queueItemId: 'b', contentId: 'plex:b', format: 'video', priority: 'queue' },
      ],
      executionOrder: ['a', 'a', 'b'], repeat: 'off',
    }), { autoplay: false }));
    await waitFor(() => expect(ref.current.getQueueSnapshot().executionOrder).toEqual(['a', 'a', 'b']));

    act(() => latestSinglePlayerProps.advance());
    expect(ref.current.getQueueSnapshot()).toMatchObject({ currentIndex: 0, executionOrder: ['a', 'b'] });
    expect(node.currentTime).toBe(18);
    expect(play).not.toHaveBeenCalled();
    expect(latestSinglePlayerProps.remountDiagnostics.rendererOperation).toMatchObject({ targetSeconds: 0, autoplay: true });
    // A second ended/watchdog delivery from visit one cannot consume visit two.
    act(() => latestSinglePlayerProps.advance());
    expect(ref.current.getQueueSnapshot()).toMatchObject({ currentIndex: 0, executionOrder: ['a', 'b'] });
    expect(play).not.toHaveBeenCalled();

    act(() => latestSinglePlayerProps.onPlaybackMetrics({ seconds: 0, isPaused: false }));
    act(() => latestSinglePlayerProps.onPlaybackMetrics({ seconds: 1, isPaused: false }));
    node.currentTime = 18;
    act(() => latestSinglePlayerProps.advance());
    expect(ref.current.getQueueSnapshot()).toMatchObject({ currentIndex: 1, executionOrder: ['b'] });
    expect(play).not.toHaveBeenCalled();
  });

  it('withholds legacy native proof after same-content adoption until actual registration changes', async () => {
    const node = document.createElement('video');
    Object.defineProperties(node, {
      currentTime: { configurable: true, writable: true, value: 10 },
      duration: { configurable: true, value: 180 },
      readyState: { configurable: true, value: 3 },
      paused: { configurable: true, value: false },
      seeking: { configurable: true, value: false },
      ended: { configurable: true, value: false },
      error: { configurable: true, value: null },
    });
    mockMediaElement = node;
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:native-a', title: 'A', format: 'video' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(1));
    act(() => latestSinglePlayerProps.onMediaRef(node, { contentId: 'plex:native-a' }));

    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({
      getPlayerHandle: () => ref.current,
      registry,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
    bridge.start();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen', sessionId: 'native-adopt-session' });
    expect(source.getNativeObservation().identity).not.toBeNull();
    node.dispatchEvent(new Event('playing'));
    node.currentTime = 11;
    node.dispatchEvent(new Event('timeupdate'));
    expect(source.getNativeObservation()).toMatchObject({ playingObserved: true, advancedObserved: true });

    const actualGeneration = ref.current.getMountedMediaGeneration();
    const captured = source.capture().snapshot;
    captured.position = 40;
    expect(source.adopt(captured, { autoplay: false })).toEqual({ ok: true });
    await waitFor(() => expect(ref.current.getQueueSnapshot().executionOrder).toEqual(captured.queue.executionOrder));
    expect(ref.current.getMountedMediaGeneration()).toBe(actualGeneration);
    expect(source.getNativeObservation()).toMatchObject({
      identity: null,
      playingObserved: false,
      advancedObserved: false,
    });
    node.dispatchEvent(new Event('playing'));
    node.currentTime = 12;
    node.dispatchEvent(new Event('timeupdate'));
    expect(source.getNativeObservation()).toMatchObject({
      identity: null,
      playingObserved: false,
      advancedObserved: false,
    });
    bridge.stop();
  });

  it('withholds fresh-bridge proof when same-content adoption postdates actual registration', async () => {
    // Break caught: bridge-local history cannot be required for provenance; a
    // fresh bridge must see that this unchanged node was registered by the old
    // logical owner rather than attributing it to the adopted revision.
    const node = document.createElement('video');
    Object.defineProperties(node, {
      currentTime: { configurable: true, writable: true, value: 10 },
      duration: { configurable: true, value: 180 },
      readyState: { configurable: true, value: 3 },
      paused: { configurable: true, value: false },
      seeking: { configurable: true, value: false },
      ended: { configurable: true, value: false },
      error: { configurable: true, value: null },
    });
    mockMediaElement = node;
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:native-a', title: 'A', format: 'video' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(1));
    act(() => latestSinglePlayerProps.onMediaRef(node, { contentId: 'plex:native-a' }));
    const registeredGeneration = ref.current.getMountedMediaGeneration();
    const registeredRevision = ref.current.getPlaybackIdentity().playbackRevision;

    act(() => ref.current.adoptSessionSnapshot(adoptionSnapshot({
      items: [{ queueItemId: 'adopted-a', contentId: 'plex:native-a', format: 'video', priority: 'queue' }],
      executionOrder: ['adopted-a'], repeat: 'off',
    }), { autoplay: false }));
    await waitFor(() => expect(ref.current.getQueueSnapshot().executionOrder).toEqual(['adopted-a']));
    expect(ref.current.getMountedMediaGeneration()).toBe(registeredGeneration);
    expect(ref.current.getPlaybackIdentity().playbackRevision).toBeGreaterThan(registeredRevision);

    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({
      getPlayerHandle: () => ref.current,
      registry,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
    bridge.start();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen', sessionId: 'fresh-native-adopt' });
    expect(source.getNativeObservation()).toMatchObject({
      node,
      resolvedContentId: 'plex:native-a',
      resolvedGeneration: registeredGeneration,
      identity: null,
      playingObserved: false,
      advancedObserved: false,
    });
    node.dispatchEvent(new Event('playing'));
    node.currentTime = 11;
    node.dispatchEvent(new Event('timeupdate'));
    expect(source.getNativeObservation()).toMatchObject({
      identity: null,
      playingObserved: false,
      advancedObserved: false,
    });
    bridge.stop();
  });

  it('retains a single adopted repeat-one entry on natural completion', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[]} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    ref.current.adoptSessionSnapshot(adoptionSnapshot({
      items: [{ queueItemId: 'only', contentId: 'plex:only', format: 'video', priority: 'queue' }],
      executionOrder: ['only'], repeat: 'one',
    }), { autoplay: false });
    await waitFor(() => expect(latestSinglePlayerProps?.advance).toEqual(expect.any(Function)));
    act(() => latestSinglePlayerProps.advance());
    expect(ref.current.getQueueSnapshot()).toMatchObject({ currentIndex: 0, executionOrder: ['only'] });
  });

  it('guards legacy Stop at the Player owner and retains its queue', async () => {
    const node = document.createElement('video');
    const pause = vi.fn();
    Object.defineProperties(node, {
      pause: { configurable: true, value: pause },
      paused: { configurable: true, value: false },
      ended: { configurable: true, value: false },
      currentTime: { configurable: true, writable: true, value: 17 },
    });
    const ref = createRef();
    render(<Player ref={ref} play={[
      { contentId: 'plex:a', title: 'Same title', format: 'video' },
      { contentId: 'plex:b', title: 'B', format: 'video' },
    ]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(2));
    act(() => latestSinglePlayerProps.onMediaRef(node, { contentId: 'plex:a' }));
    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({ getPlayerHandle: () => ref.current, registry, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    bridge.start();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen', sessionId: 'guard-session' });
    const stale = source.capture().identity;

    act(() => ref.current.play());
    expect(source.stopIfCurrent(stale)).toEqual({ ok: false, code: 'SOURCE_CHANGED' });
    expect(pause).not.toHaveBeenCalled();
    const fresh = source.capture().identity;
    const retained = ref.current.getQueueSnapshot().items.map((item) => item.queueItemId);
    expect(source.stopIfCurrent(fresh)).toEqual({ ok: true });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(ref.current.getQueueSnapshot().items.map((item) => item.queueItemId)).toEqual(retained);
    expect(source.capture().snapshot.state).toBe('ready');
    bridge.stop();
  });

  it('exposes a detached, lossless duplicate queue from the actual Player owner', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[
      { contentId: 'plex:a', title: 'A', format: 'video' },
      { contentId: 'plex:b', title: 'B', format: 'video' },
      { contentId: 'plex:a', title: 'A again', format: 'video' },
    ]} />);

    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(3));
    const first = ref.current.getQueueSnapshot();
    const second = ref.current.getQueueSnapshot();

    expect(first.items.map((item) => item.contentId)).toEqual(['plex:a', 'plex:b', 'plex:a']);
    expect(new Set(first.items.map((item) => item.queueItemId)).size).toBe(3);
    expect(first.executionOrder[0]).toBe(first.items[first.currentIndex].queueItemId);
    first.items[0].title = 'consumer mutation';
    expect(second.items[0].title).toBe('A');
    expect(ref.current.getPlayerInstanceId()).toEqual(expect.any(String));
    expect(ref.current.getShader()).toBe('default');
  });

  it('issues owner revisions for actual duplicate advance, restart, and config actions before bridge observation', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[
      { contentId: 'plex:a', title: 'A', format: 'video' },
      { contentId: 'plex:b', title: 'B', format: 'video' },
      { contentId: 'plex:a', title: 'A again', format: 'video' },
    ]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(3));

    const registry = createPlayerSessionRegistry();
    let poll = null;
    const bridge = createPlayerSessionBridge({
      getPlayerHandle: () => ref.current,
      registry,
      setIntervalFn: (fn) => { poll = fn; return 1; },
      clearIntervalFn: () => {},
    });
    bridge.start();
    poll();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen-owner', sessionId: 'screen-session' });
    const initialSnapshot = source.getSnapshot();
    const initial = initialSnapshot.meta.playbackOwner;

    // No bridge poll, native event, or source capture occurs inside this owner
    // action burst. Revisions must be minted by Player, not reconstructed by
    // the bridge after the fact.
    act(() => {
      ref.current.advance(); // A → B
      ref.current.advance(); // B → duplicate A
      ref.current.seekToItem('plex:a', 0); // duplicate A → original A
      ref.current.play(); // same-entry restart
      ref.current.play(); // another restart without a native event
    });
    await waitFor(() => expect(ref.current.getQueueSnapshot().currentIndex).toBe(0));
    poll();
    const afterOwnerBurst = source.getSnapshot();
    expect(afterOwnerBurst.meta.playbackOwner.playbackRevision).toBeGreaterThan(initial.playbackRevision);
    expect(afterOwnerBurst.meta.playbackOwner.queueRevision).toBeGreaterThan(initial.queueRevision);

    // A config change that returns to the same values is still a distinct
    // owner action and cannot be reconstructed from the final config object.
    act(() => {
      ref.current.setVolume(0.73);
      ref.current.setVolume(initialSnapshot.config.volume / 100); // config change → revert
      ref.current.setPlaybackRate(1.25);
      ref.current.setPlaybackRate(initialSnapshot.config.playbackRate);
    });
    poll();
    const afterConfigBurst = source.getSnapshot();
    expect(afterConfigBurst.meta.playbackOwner.playbackRevision).toBe(afterOwnerBurst.meta.playbackOwner.playbackRevision);
    expect(afterConfigBurst.meta.playbackOwner.queueRevision).toBeGreaterThan(afterOwnerBurst.meta.playbackOwner.queueRevision);

    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'play-next', contentId: 'plex:next' });
    });
    await waitFor(() => expect(ref.current.getQueueSnapshot().items).toHaveLength(4));
    act(() => { ref.current.setVolume(0.73); ref.current.setPlaybackRate(1.25); });
    poll();

    const captured = source.getSnapshot();
    expect(captured.queue.items.map((item) => item.contentId)).toEqual(['plex:a', 'plex:b', 'plex:a', 'plex:next']);
    expect(captured.queue.currentIndex).toBe(0);
    expect(captured.queue.executionOrder[0]).toBe(captured.queue.items[0].queueItemId);
    expect(captured.queue.executionOrder[1]).toBe(captured.queue.items[3].queueItemId);
    expect(captured.meta.playbackOwner).toMatchObject({
      ownerInstanceId: ref.current.getPlayerInstanceId(), sessionId: 'screen-session',
      queueItemId: captured.queue.items[0].queueItemId, contentId: 'plex:a',
    });
    expect(captured.meta.playbackOwner.playbackRevision).toBe(afterConfigBurst.meta.playbackOwner.playbackRevision);
    expect(captured.meta.playbackOwner.queueRevision).toBeGreaterThan(afterConfigBurst.meta.playbackOwner.queueRevision);
    expect(captured.config).toMatchObject({ volume: 73, playbackRate: 1.25 });
    bridge.stop();
  });

  it('issues playback revision at real media-access node replacement before a bridge poll, ignoring old-node events', async () => {
    const initialNode = document.createElement('video');
    const replacementNode = document.createElement('video');
    Object.defineProperties(initialNode, { paused: { configurable: true, value: true }, ended: { configurable: true, value: false } });
    Object.defineProperties(replacementNode, { paused: { configurable: true, value: true }, ended: { configurable: true, value: false } });
    mockMediaElement = initialNode;
    const ref = createRef();
    const view = render(<Player ref={ref} play={[{ contentId: 'plex:a', title: 'A', format: 'video' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(1));

    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({ getPlayerHandle: () => ref.current, registry, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    bridge.start();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen-owner', sessionId: 'node-session' });
    const initial = source.getSnapshot().meta.playbackOwner;

    mockMediaElement = replacementNode;
    view.rerender(<Player ref={ref} nodeEpoch={1} play={[{ contentId: 'plex:a', title: 'A', format: 'video' }]} />);
    await waitFor(() => expect(ref.current.getMediaElement()).toBe(replacementNode));
    const afterReplacement = ref.current.getPlaybackIdentity();
    initialNode.dispatchEvent(new Event('playing'));
    expect(ref.current.getPlaybackIdentity()).toEqual(afterReplacement);

    const later = source.getSnapshot().meta.playbackOwner;
    expect(later.playbackRevision).toBeGreaterThan(initial.playbackRevision);
    expect(later.queueRevision).toBe(initial.queueRevision);
    bridge.stop();
  });

  it('issues queue and playback revisions when the same Player loads a new source before observation', async () => {
    const ref = createRef();
    const view = render(<Player ref={ref} play={[{ contentId: 'plex:a', title: 'A', format: 'video' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items[0]?.contentId).toBe('plex:a'));
    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({ getPlayerHandle: () => ref.current, registry, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    bridge.start();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen-owner', sessionId: 'reload-session' });
    const initial = source.getSnapshot().meta.playbackOwner;

    view.rerender(<Player ref={ref} play={[{ contentId: 'plex:b', title: 'B', format: 'video' }]} />);
    await waitFor(() => expect(ref.current.getQueueSnapshot().items[0]?.contentId).toBe('plex:b'));
    const later = source.getSnapshot().meta.playbackOwner;

    expect(later.ownerInstanceId).toBe(initial.ownerInstanceId);
    expect(later.playbackRevision).toBeGreaterThan(initial.playbackRevision);
    expect(later.queueRevision).toBeGreaterThan(initial.queueRevision);
    bridge.stop();
  });

  it.each(['onMediaRef', 'onRegisterMediaAccess'].flatMap((surface) =>
    ['unseen node', 'cleanup', 'retired node'].map((staleKind) => [surface, staleKind])
  ))('%s rejects stale %s during same-content recovery', async (surface, staleKind) => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', title: 'A', format: 'video' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(1));
    const initialNode = document.createElement('video');
    const replacementNode = document.createElement('video');
    initialNode.currentTime = 12;
    replacementNode.currentTime = 42;
    const register = (callback, node) => surface === 'onMediaRef'
      ? callback(node, { contentId: 'plex:a' })
      : callback(node ? { getMediaEl: () => node } : {});
    const oldCallback = latestSinglePlayerProps[surface];
    act(() => register(oldCallback, initialNode));
    const initial = ref.current.getPlaybackIdentity();
    const replacementCallback = latestSinglePlayerProps[surface];
    act(() => register(replacementCallback, replacementNode));
    const recovered = ref.current.getPlaybackIdentity();
    expect(recovered.playbackRevision).toBeGreaterThan(initial.playbackRevision);
    expect(recovered.queueRevision).toBe(initial.queueRevision);
    expect(ref.current.getMediaElement()).toBe(replacementNode);

    // A delayed registration is different from a stale native event: it used
    // to write both ownership refs and the current owner's revision.
    const staleNode = staleKind === 'unseen node' ? document.createElement('video')
      : staleKind === 'cleanup' ? null : initialNode;
    act(() => register(oldCallback, staleNode));
    expect(ref.current.getPlaybackIdentity()).toEqual(recovered);
    expect(ref.current.getMediaElement()).toBe(replacementNode);
    expect(ref.current.getCurrentTime()).toBe(42);

    act(() => {
      latestSinglePlayerProps.onResolvedMeta({ contentId: 'plex:a', title: 'Enriched A', format: 'video', duration: 180 });
      replacementNode.dispatchEvent(new Event('waiting'));
      replacementNode.dispatchEvent(new Event('focus'));
      latestSinglePlayerProps.onPlaybackMetrics({ seconds: 43, isPaused: false, stalled: true });
      register(latestSinglePlayerProps[surface], replacementNode);
    });
    expect(ref.current.getPlaybackIdentity()).toEqual(recovered);
    // Cleanup from the callback that ADMITTED B still releases this surface,
    // even after its registration has caused React to refresh callback props. A
    // later valid registration can recover it without faking a new playback.
    act(() => register(replacementCallback, null));
    expect(ref.current.getMediaElement()).toBeNull();
    expect(ref.current.getPlaybackIdentity()).toEqual(recovered);
    act(() => register(replacementCallback, replacementNode));
    expect(ref.current.getMediaElement()).toBe(replacementNode);
    expect(ref.current.getPlaybackIdentity()).toEqual(recovered);
  });

  it.each(['onMediaRef', 'onRegisterMediaAccess'])('rejects late %s registration and cleanup from a remounted renderer', async (surface) => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', title: 'A', format: 'video' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(1));
    const initialNode = document.createElement('video');
    const replacementNode = document.createElement('video');
    const unseenOldNode = document.createElement('video');
    const register = (callback, node) => surface === 'onMediaRef'
      ? callback(node, { contentId: 'plex:a' })
      : callback(node ? { getMediaEl: () => node } : {});
    const oldCallback = latestSinglePlayerProps[surface];
    act(() => register(oldCallback, initialNode));
    const priorSession = latestSinglePlayerProps.plexClientSession;
    act(() => ref.current.forceMediaReload({ forceRemount: true }));
    await waitFor(() => expect(latestSinglePlayerProps.plexClientSession).not.toBe(priorSession));
    act(() => register(latestSinglePlayerProps[surface], replacementNode));
    const recovered = ref.current.getPlaybackIdentity();

    // A new node from the retired renderer cannot be admitted either. A
    // retired-node blacklist alone would miss this callback-lifetime case.
    for (const staleNode of [initialNode, unseenOldNode, null]) {
      act(() => register(oldCallback, staleNode));
      expect(ref.current.getPlaybackIdentity()).toEqual(recovered);
      expect(ref.current.getMediaElement()).toBe(replacementNode);
    }
  });

  it.each([
    ['restarts a non-queue continuous item', true, false],
    ['stops a non-queue completed item', false, true],
  ])('issues playback revision when natural completion %s before observation', async (_label, continuous, expectsClear) => {
    const { DaylightAPI } = await import('../../lib/api.mjs');
    DaylightAPI.mockResolvedValueOnce({ items: [{ id: 'plex:single', contentId: 'plex:single', title: 'Single', format: 'video' }], audio: null });
    const clear = vi.fn();
    const ref = createRef();
    render(<Player ref={ref} clear={clear} play={{ contentId: 'plex:single', title: 'Single', format: 'video', continuous }} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot()?.items).toHaveLength(1));
    const registry = createPlayerSessionRegistry();
    const bridge = createPlayerSessionBridge({ getPlayerHandle: () => ref.current, registry, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    bridge.start();
    const source = createRegistrySessionSource({ registry, ownerId: 'screen-owner', sessionId: `single-${continuous}` });
    const initial = source.getSnapshot().meta.playbackOwner;

    act(() => latestSinglePlayerProps.advance());
    expect(clear).toHaveBeenCalledTimes(expectsClear ? 1 : 0);
    const later = source.getSnapshot().meta.playbackOwner;
    expect(later.playbackRevision).toBeGreaterThan(initial.playbackRevision);
    bridge.stop();
  });
});
