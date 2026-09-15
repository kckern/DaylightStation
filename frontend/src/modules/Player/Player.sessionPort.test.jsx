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

afterEach(() => {
  cleanup();
  __resetPlayerQueueOpRegistryForTests();
  mockMediaElement = null;
  latestSinglePlayerProps = null;
});

describe('Player session port', () => {
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
