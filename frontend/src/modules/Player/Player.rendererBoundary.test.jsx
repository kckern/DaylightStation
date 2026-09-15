import React, { createRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ items: [], audio: null })),
}));

const mounts = [];
let latestProps = null;

vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: (props) => {
    const nodeRef = React.useRef(null);
    if (!nodeRef.current) {
      const node = document.createElement('video');
      Object.defineProperties(node, {
        currentTime: { configurable: true, writable: true, value: 0 },
        duration: { configurable: true, value: 120 },
        readyState: { configurable: true, value: 3 },
        paused: { configurable: true, writable: true, value: true },
      });
      nodeRef.current = node;
    }
    latestProps = props;
    React.useEffect(() => {
      const node = nodeRef.current;
      const operation = props.remountDiagnostics?.rendererOperation ?? null;
      const rendererToken = Object.freeze({
        tokenId: `renderer-${mounts.length + 1}`,
        operationId: operation?.operationId ?? null,
        node,
        resolvedContentId: props.contentId,
      });
      const begin = vi.fn(() => ({ ok: true }));
      const cancel = vi.fn();
      const frame = { node, rendererToken, begin, cancel, props };
      mounts.push(frame);
      props.onMediaRef?.(node, { contentId: props.contentId, rendererToken });
      props.onRegisterMediaAccess?.({
        getMediaEl: () => node,
        beginMountedPlaybackOperation: begin,
        cancelMountedPlaybackOperation: cancel,
      });
      return () => {
        props.onMediaRef?.(null, { contentId: props.contentId, rendererToken });
        props.onRegisterMediaAccess?.({});
      };
      // this fixture models a physical renderer mount, not prop updates
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="renderer" />;
  },
}));

import Player from './Player.jsx';

const snapshot = ({ repeat = 'off', position = 0, contentId = 'plex:a', queueItemId = 'a' } = {}) => ({
  sessionId: 'renderer-boundary-session',
  state: 'paused',
  currentItem: { contentId, format: 'video', title: contentId },
  position,
  queue: {
    items: [{ queueItemId, contentId, format: 'video', title: contentId, priority: 'queue' }],
    currentIndex: 0,
    upNextCount: 0,
    executionOrder: [queueItemId],
  },
  config: { shuffle: false, repeat, shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'source', updatedAt: '2026-09-15T00:00:00.000Z' },
});

beforeEach(() => {
  mounts.length = 0;
  latestProps = null;
});

afterEach(() => cleanup());

describe('Player explicit renderer boundary', () => {
  it('admits a fresh physical node only after the calling observer acks the exact renderer token', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video', title: 'A' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const old = mounts[0];
    const order = [];
    const subscription = ref.current.subscribeMountedMediaOperations((binding) => {
      order.push(['observer', binding.node, binding.rendererToken]);
      return { ready: true, ...binding };
    });

    act(() => {
      expect(ref.current.adoptSessionSnapshot(snapshot({ position: 17 }), {
        autoplay: false,
        operationId: 'adopt-a-1',
        requiredObserverIds: [subscription.observerId],
      })).toEqual({ ok: true });
    });

    await waitFor(() => expect(mounts).toHaveLength(2));
    const fresh = mounts[1];
    expect(fresh.node).not.toBe(old.node);
    expect(ref.current.getMountedMediaRegistration()).toMatchObject({
      node: fresh.node,
      resolvedContentId: 'plex:a',
      rendererToken: fresh.rendererToken,
    });
    expect(fresh.rendererToken).not.toBe(ref.current.getMountedMediaRegistration().lifetimeToken);
    expect(order).toEqual([['observer', fresh.node, fresh.rendererToken]]);
    expect(fresh.begin).toHaveBeenCalledWith(fresh.rendererToken);
    expect(fresh.props.remountDiagnostics.rendererOperation).toMatchObject({
      operationId: 'adopt-a-1', targetSeconds: 17, autoplay: false,
    });

    // A retired renderer cannot restore its node or accessor after replacement.
    act(() => {
      old.props.onMediaRef(old.node, { contentId: 'plex:a', rendererToken: old.rendererToken });
      old.props.onRegisterMediaAccess?.({ getMediaEl: () => old.node });
    });
    expect(ref.current.getMediaElement()).toBe(fresh.node);
    expect(ref.current.getMountedMediaRegistration().rendererToken).toBe(fresh.rendererToken);
    subscription.unsubscribe();
  });

  it('fails closed when the required observer disappeared before admission', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const subscription = ref.current.subscribeMountedMediaOperations((binding) => ({ ready: true, ...binding }));
    subscription.unsubscribe();

    act(() => {
      ref.current.adoptSessionSnapshot(snapshot(), {
        autoplay: true,
        operationId: 'missing-observer',
        requiredObserverIds: [subscription.observerId],
      });
    });

    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(mounts[1].begin).not.toHaveBeenCalled();
  });

  it.each([
    ['idle', []],
    ['different-content', [{ contentId: 'plex:a', format: 'video' }]],
  ])('atomically adopts from %s and begins exactly one admitted renderer', async (_label, initialPlay) => {
    const ref = createRef();
    render(<Player ref={ref} play={initialPlay} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    if (initialPlay.length) await waitFor(() => expect(mounts).toHaveLength(1));
    const initialMounts = mounts.length;
    const subscription = ref.current.subscribeMountedMediaOperations((binding) => ({ ready: true, ...binding }));

    act(() => ref.current.adoptSessionSnapshot(snapshot({
      contentId: 'plex:b', queueItemId: 'b', position: 9,
    }), {
      autoplay: true,
      operationId: `adopt-${_label}`,
      requiredObserverIds: [subscription.observerId],
    }));

    await waitFor(() => expect(mounts).toHaveLength(initialMounts + 1));
    const admitted = mounts.at(-1);
    expect(admitted.props.contentId).toBe('plex:b');
    expect(admitted.begin).toHaveBeenCalledTimes(1);
    expect(admitted.cancel).not.toHaveBeenCalled();
    expect(admitted.props.remountDiagnostics.rendererOperation).toMatchObject({
      operationId: `adopt-${_label}`, targetSeconds: 9, autoplay: true,
    });
    subscription.unsubscribe();
  });

  it('supersedes an unregistered operation and Stop prevents the pending renderer from beginning', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const subscription = ref.current.subscribeMountedMediaOperations((binding) => ({ ready: true, ...binding }));
    act(() => {
      ref.current.beginRendererBoundary({
        operationId: 'superseded-1', expectedContentId: 'plex:a', targetSeconds: 1,
        requiredObserverIds: [subscription.observerId],
      });
      ref.current.beginRendererBoundary({
        operationId: 'winner-2', expectedContentId: 'plex:a', targetSeconds: 2,
        requiredObserverIds: [subscription.observerId],
      });
    });
    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(mounts[1].rendererToken.operationId).toBe('winner-2');
    expect(mounts[1].begin).toHaveBeenCalledTimes(1);

    const identity = ref.current.getPlaybackIdentity();
    const current = ref.current.getQueueSnapshot().items[ref.current.getQueueSnapshot().currentIndex];
    act(() => {
      ref.current.beginRendererBoundary({
        operationId: 'stopped-3', expectedContentId: 'plex:a', targetSeconds: 3,
        requiredObserverIds: [subscription.observerId],
      });
      expect(ref.current.stopIfCurrent({
        ...identity,
        sessionId: 'stop-session',
        contentId: current.contentId,
        queueItemId: current.queueItemId,
      }, 'stop-session')).toEqual({ ok: true });
    });
    await waitFor(() => expect(mounts).toHaveLength(3));
    expect(mounts[2].rendererToken.operationId).toBe('stopped-3');
    expect(mounts[2].begin).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('rejects a duplicate operation id when immutable execution arguments differ', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));

    act(() => {
      expect(ref.current.beginRendererBoundary({
        operationId: 'collision-1',
        expectedContentId: 'plex:a',
        targetSeconds: 3,
        autoplay: true,
      })).toEqual({ ok: true, operationId: 'collision-1' });
      expect(ref.current.beginRendererBoundary({
        operationId: 'collision-1',
        expectedContentId: 'plex:a',
        targetSeconds: 19,
        autoplay: false,
      })).toEqual({ ok: false, code: 'RENDERER_OPERATION_CONFLICT' });
    });
  });

  it('does not add an unacknowledged observer to an operation that already started', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const first = ref.current.subscribeMountedMediaOperations((binding) => ({ ready: true, ...binding }));
    act(() => {
      expect(ref.current.beginRendererBoundary({
        operationId: 'started-1',
        expectedContentId: 'plex:a',
        targetSeconds: 4,
        autoplay: true,
        requiredObserverIds: [first.observerId],
      })).toEqual({ ok: true, operationId: 'started-1' });
    });
    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(mounts[1].begin).toHaveBeenCalledTimes(1);

    const lateObserver = vi.fn((binding) => ({ ready: true, ...binding }));
    const late = ref.current.subscribeMountedMediaOperations(lateObserver);
    expect(ref.current.beginRendererBoundary({
      operationId: 'started-1',
      expectedContentId: 'plex:a',
      targetSeconds: 4,
      autoplay: true,
      requiredObserverIds: [first.observerId, late.observerId],
    })).toEqual({ ok: false, code: 'RENDERER_OPERATION_CONFLICT' });
    expect(lateObserver).not.toHaveBeenCalled();
    first.unsubscribe();
    late.unsubscribe();
  });

  it('does not carry a completed owner operation into ordinary different-content playback', async () => {
    const ref = createRef();
    const view = render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const subscription = ref.current.subscribeMountedMediaOperations((binding) => ({ ready: true, ...binding }));
    act(() => {
      ref.current.beginRendererBoundary({
        operationId: 'completed-a',
        expectedContentId: 'plex:a',
        targetSeconds: 8,
        autoplay: false,
        requiredObserverIds: [subscription.observerId],
      });
    });
    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(mounts[1].begin).toHaveBeenCalledTimes(1);

    view.rerender(<Player ref={ref} play={[{ contentId: 'plex:b', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(3));
    expect(mounts[2].props.contentId).toBe('plex:b');
    expect(mounts[2].props.remountDiagnostics).toBeNull();
    expect(mounts[2].rendererToken.operationId).toBeNull();
    expect(mounts[2].begin).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('drops an unstarted owner operation when ordinary different-content playback supersedes it', async () => {
    const ref = createRef();
    const view = render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    act(() => {
      ref.current.beginRendererBoundary({
        operationId: 'abandoned-a',
        expectedContentId: 'plex:a',
        targetSeconds: 6,
        autoplay: false,
        requiredObserverIds: ['observer-that-never-existed'],
      });
    });
    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(mounts[1].begin).not.toHaveBeenCalled();

    view.rerender(<Player ref={ref} play={[{ contentId: 'plex:b', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(3));
    expect(mounts[2].props.contentId).toBe('plex:b');
    expect(mounts[2].props.remountDiagnostics).toBeNull();
    expect(mounts[2].rendererToken.operationId).toBeNull();
    expect(mounts[2].begin).not.toHaveBeenCalled();
  });

  it('does not carry a completed contentId operation into an ordinary legacy-id load', async () => {
    const ref = createRef();
    const view = render(<Player ref={ref} play={[{
      contentId: 'plex:a', plex: 'a', format: 'video',
    }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const subscription = ref.current.subscribeMountedMediaOperations((binding) => ({ ready: true, ...binding }));
    act(() => {
      ref.current.beginRendererBoundary({
        operationId: 'completed-content-id-a',
        expectedContentId: 'plex:a',
        targetSeconds: 2,
        autoplay: true,
        requiredObserverIds: [subscription.observerId],
      });
    });
    await waitFor(() => expect(mounts).toHaveLength(2));
    expect(mounts[1].begin).toHaveBeenCalledTimes(1);

    view.rerender(<Player ref={ref} play={[{ plex: 'b', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(3));
    expect(mounts[2].props.plex).toBe('b');
    expect(mounts[2].props.remountDiagnostics).toBeNull();
    expect(mounts[2].rendererToken.operationId).toBeNull();
    subscription.unsubscribe();
  });

  it.each(['one', 'all'])('allows more than ten deduplicated repeat-%s visits without weakening the recovery brake', async (repeat) => {
    const ref = createRef();
    render(<Player ref={ref} play={[]} />);
    await waitFor(() => expect(ref.current).toBeTruthy());
    act(() => ref.current.adoptSessionSnapshot(snapshot({ repeat }), { autoplay: false }));
    await waitFor(() => expect(latestProps?.advance).toBeTypeOf('function'));

    for (let lap = 0; lap < 12; lap += 1) {
      const priorMounts = mounts.length;
      act(() => latestProps.advance());
      await waitFor(() => expect(mounts.length).toBe(priorMounts + 1));
      act(() => {
        latestProps.onPlaybackMetrics({ seconds: 0, isPaused: false });
        latestProps.onPlaybackMetrics({ seconds: 1, isPaused: false });
      });
    }

    expect(mounts).toHaveLength(13);
    expect(ref.current.getQueueSnapshot()).toMatchObject({ currentIndex: 0, executionOrder: ['a'] });
  });

  it('rejects unsupported and live boundaries before replacing the physical renderer', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    expect(ref.current.beginRendererBoundary({
      operationId: 'unsupported-1', expectedContentId: 'plex:a', targetSeconds: 0, format: 'image',
    })).toEqual({ ok: false, code: 'UNSUPPORTED_RENDERER_FORMAT' });
    expect(ref.current.beginRendererBoundary({
      operationId: 'live-1', expectedContentId: 'plex:a', targetSeconds: 0, format: 'video', isLive: true,
    })).toEqual({ ok: false, code: 'LIVE_EDGE_UNSUPPORTED' });
    expect(mounts).toHaveLength(1);
  });

  it.each([
    ['unsupported format', { format: 'image', isLive: false }, 'UNSUPPORTED_RENDERER_FORMAT'],
    ['live media', { format: 'video', isLive: true }, 'LIVE_EDGE_UNSUPPORTED'],
  ])('rejects %s adoption before changing owner or native state', async (_label, media, code) => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const before = {
      queue: ref.current.getQueueSnapshot(),
      config: ref.current.getQueueConfig(),
      identity: ref.current.getPlaybackIdentity(),
      node: ref.current.getMediaElement(),
      generation: ref.current.getMountedMediaGeneration(),
      position: ref.current.getCurrentTime(),
    };
    const incoming = snapshot({ contentId: 'plex:b', queueItemId: 'b', position: 27 });
    incoming.currentItem = { ...incoming.currentItem, ...media };
    incoming.queue.items[0] = { ...incoming.queue.items[0], ...media };

    let result;
    act(() => {
      result = ref.current.adoptSessionSnapshot(incoming, {
        operationId: `rejected-${code}`,
        autoplay: true,
      });
    });
    expect(result).toEqual({ ok: false, code });
    expect(ref.current.getQueueSnapshot()).toEqual(before.queue);
    expect(ref.current.getQueueConfig()).toEqual(before.config);
    expect(ref.current.getPlaybackIdentity()).toEqual(before.identity);
    expect(ref.current.getMediaElement()).toBe(before.node);
    expect(ref.current.getMountedMediaGeneration()).toBe(before.generation);
    expect(ref.current.getCurrentTime()).toBe(before.position);
    expect(mounts).toHaveLength(1);
  });

  it('rejects a conflicting duplicate public adoption before changing owner state', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:a', format: 'video' }]} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const subscription = ref.current.subscribeMountedMediaOperations((binding) => ({ ready: true, ...binding }));
    act(() => {
      expect(ref.current.adoptSessionSnapshot(snapshot({ position: 17 }), {
        operationId: 'public-adopt-1',
        autoplay: false,
        requiredObserverIds: [subscription.observerId],
      })).toEqual({ ok: true });
    });
    await waitFor(() => expect(mounts).toHaveLength(2));
    const before = {
      queue: ref.current.getQueueSnapshot(),
      config: ref.current.getQueueConfig(),
      identity: ref.current.getPlaybackIdentity(),
      node: ref.current.getMediaElement(),
      generation: ref.current.getMountedMediaGeneration(),
    };

    let result;
    act(() => {
      result = ref.current.adoptSessionSnapshot(snapshot({
        contentId: 'plex:b', queueItemId: 'b', position: 23, repeat: 'all',
      }), {
        operationId: 'public-adopt-1',
        autoplay: true,
        requiredObserverIds: [subscription.observerId],
      });
    });
    expect(result).toEqual({ ok: false, code: 'RENDERER_OPERATION_CONFLICT' });
    expect(ref.current.getQueueSnapshot()).toEqual(before.queue);
    expect(ref.current.getQueueConfig()).toEqual(before.config);
    expect(ref.current.getPlaybackIdentity()).toEqual(before.identity);
    expect(ref.current.getMediaElement()).toBe(before.node);
    expect(ref.current.getMountedMediaGeneration()).toBe(before.generation);
    expect(mounts).toHaveLength(2);
    subscription.unsubscribe();
  });

});
