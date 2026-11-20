import React, { createRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPlayerQueueOpRegistryForTests,
  getPlayerQueueOpRegistry,
} from './lib/queueOpRegistry.js';

let transport;
vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: ({ contentId, onController, volume }) => {
    React.useEffect(() => {
      onController?.(transport);
    }, [onController]);
    return <div data-testid="single-player" data-content-id={contentId} data-volume={volume} />;
  },
}));

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/queue/query:birthday') {
      return {
        audio: { contentId: 'plex:music', behavior: 'duck', duckLevel: 0.2 },
        items: [
          { contentId: 'immich:photo', id: 'immich:photo', mediaType: 'image' },
          { contentId: 'immich:video', id: 'immich:video', mediaType: 'video', shader: 'focused' },
        ],
      };
    }
    if (path === '/api/v1/queue/plex%3Amusic') {
      return { items: [{ id: 'plex:song', contentId: 'plex:song', format: 'audio' }] };
    }
    const contentId = String(path).replace(/^api\/v1\/play\//, '');
    return {
      contentId, id: contentId, title: contentId, mediaUrl: `/stream/${contentId}`,
      ...(contentId.includes('live') ? { isLive: true } : {}),
    };
  }),
}));

import Player from './Player.jsx';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { getActionBus, resetActionBus } from '../../../screen-host/browser/input/ActionBus.js';

const defaultApi = DaylightAPI.getMockImplementation();

function holdLookup(path) {
  const held = Promise.withResolvers();
  const previous = DaylightAPI.getMockImplementation();
  DaylightAPI.mockImplementation((request, ...args) => request === path ? held.promise : previous(request, ...args));
  return held;
}

const playDescriptor = contentId => ({ contentId, id: contentId, mediaUrl: '/fixture/movie.mp4', format: 'video' });

async function dispatchQueueOp(payload) {
  await act(async () => {
    expect(getPlayerQueueOpRegistry().dispatch(payload)).toBe(true);
  });
}

describe('Player queue-op ownership integration', () => {
  beforeEach(() => {
    __resetPlayerQueueOpRegistryForTests();
    DaylightAPI.mockClear().mockImplementation(defaultApi);
    transport = { play: vi.fn(), pause: vi.fn(), toggle: vi.fn() };
  });
  afterEach(() => cleanup());

  it('applies live owner volume through the real Player despite seeded session volume', async () => {
    const queue = [{ contentId: 'plex:music', volume: 0.8 }];
    const { rerender } = render(<Player queue={queue} volume={1} playerType="background" />);
    await waitFor(() => expect(screen.getByTestId('single-player').dataset.volume).toBe('1'));
    rerender(<Player queue={queue} volume={0.575} playerType="background" />);
    await waitFor(() => expect(screen.getByTestId('single-player').dataset.volume).toBe('0.575'));
    rerender(<Player queue={queue} volume={0.15} playerType="background" />);
    await waitFor(() => expect(screen.getByTestId('single-player').dataset.volume).toBe('0.15'));
    rerender(<Player queue={queue} volume={1} playerType="background" />);
    await waitFor(() => expect(screen.getByTestId('single-player').dataset.volume).toBe('1'));
  });

  it('mutates only the foreground Player when two Players are mounted', async () => {
    render(
      <>
        <section data-testid="background">
          <Player play={[{ contentId: 'plex:background' }, { contentId: 'plex:background-next' }]} />
        </section>
        <section data-testid="foreground">
          <Player play={[{ contentId: 'plex:foreground' }, { contentId: 'plex:foreground-next' }]} />
        </section>
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('background').querySelector('[data-content-id]')?.dataset.contentId)
        .toBe('plex:background');
      expect(screen.getByTestId('foreground').querySelector('[data-content-id]')?.dataset.contentId)
        .toBe('plex:foreground');
    });

    await act(async () => {
      expect(getPlayerQueueOpRegistry().dispatch({ op: 'play-now', contentId: 'plex:replacement' }))
        .toBe(true);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('foreground').querySelector('[data-content-id]')?.dataset.contentId)
        .toBe('plex:replacement');
    });
    expect(screen.getByTestId('background').querySelector('[data-content-id]')?.dataset.contentId)
      .toBe('plex:background');
  });

  it('replaces the whole active queue when a collection is launched with clearRest', async () => {
    const playerRef = createRef();
    render(<Player ref={playerRef} play={[
      { contentId: 'plex:old-current' },
      { contentId: 'plex:old-tail' },
    ]} />);
    await waitFor(() => expect(playerRef.current?.getQueueSnapshot().items).toHaveLength(2));

    await act(async () => {
      expect(getPlayerQueueOpRegistry().dispatch({
        op: 'play-now', contentId: 'query:birthday', clearRest: true,
      })).toBe(true);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(playerRef.current?.getQueueSnapshot().items.map((item) => item.contentId))
        .toEqual(['immich:photo', 'immich:video']);
    });

    await waitFor(() => expect(document.querySelector('.audio-layer .player.background')).toBeTruthy());
    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'skip-next' });
    });
    await waitFor(() => {
      expect(document.querySelector('.player')).toHaveClass('focused');
    });
  });

  it('appends op=add to the foreground owner without replacing its current item', async () => {
    const backgroundRef = createRef();
    const foregroundRef = createRef();
    render(
      <>
        <section data-testid="background">
          <Player ref={backgroundRef} play={[{ contentId: 'plex:background' }]} />
        </section>
        <section data-testid="foreground">
          <Player ref={foregroundRef} play={[
            { contentId: 'plex:foreground' },
            { contentId: 'plex:foreground-next' },
          ]} />
        </section>
      </>
    );

    await waitFor(() => {
      expect(foregroundRef.current?.getQueueSnapshot().items.map((item) => item.contentId))
        .toEqual(['plex:foreground', 'plex:foreground-next']);
    });
    const beforeIdentity = foregroundRef.current.getPlaybackIdentity();
    const backgroundBefore = backgroundRef.current.getQueueSnapshot();

    await act(async () => {
      expect(getPlayerQueueOpRegistry().dispatch({ op: 'add', contentId: 'plex:added' }))
        .toBe(true);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(foregroundRef.current.getQueueSnapshot().items.map((item) => item.contentId))
        .toEqual(['plex:foreground', 'plex:foreground-next', 'plex:added']);
    });
    expect(foregroundRef.current.getQueueSnapshot().items[
      foregroundRef.current.getQueueSnapshot().currentIndex
    ]?.contentId).toBe('plex:foreground');
    expect(foregroundRef.current.getPlaybackIdentity()).toMatchObject({
      ownerInstanceId: beforeIdentity.ownerInstanceId,
      playbackRevision: beforeIdentity.playbackRevision,
      queueRevision: beforeIdentity.queueRevision + 1,
    });
    expect(backgroundRef.current.getQueueSnapshot()).toEqual(backgroundBefore);
  });

  it('does not reset the active owner shader when op=add has no shader override', async () => {
    const ref = createRef();
    const queue = [{ contentId: 'plex:foreground' }];
    queue.shader = 'dark';
    render(<Player ref={ref} queue={queue} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));
    expect(ref.current.getShader()).toBe('blackout');
    const before = ref.current.getPlaybackIdentity();

    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'add', contentId: 'plex:added' });
      await Promise.resolve();
    });

    await waitFor(() => expect(ref.current.getQueueSnapshot().items).toHaveLength(2));
    expect(ref.current.getShader()).toBe('blackout');
    expect(ref.current.getPlaybackIdentity()).toMatchObject({
      playbackRevision: before.playbackRevision,
      queueRevision: before.queueRevision + 1,
    });
  });

  it.each([false, true])('keeps a stopped owner stopped when a pending Play Now lookup completes (clearRest=%s)', async clearRest => {
    const path = clearRest ? 'api/v1/queue/plex:pending' : 'api/v1/play/plex:pending';
    const held = holdLookup(path);
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    const onResult = vi.fn();
    await dispatchQueueOp({ op: 'play-now', contentId: 'plex:pending', clearRest, onResult });
    const request = DaylightAPI.mock.calls.find(([url]) => url === path);
    expect(request?.[3].signal.aborted).toBe(false);
    await dispatchQueueOp({ op: 'stop' });
    expect(ref.current.getNowPlaying()).toMatchObject({ item: null, stopped: true });
    expect(request[3].signal.aborted).toBe(true);

    const item = playDescriptor('plex:pending');
    await act(async () => held.resolve(clearRest ? { items: [item] } : item));
    expect(ref.current.getNowPlaying()).toMatchObject({ item: null, stopped: true });
    expect(ref.current.getQueueSnapshot().items[0].contentId).toBe('plex:current');
    expect(onResult).toHaveBeenCalledWith({ ok: false, code: 'PLAYBACK_CHANGED' });
  });

  it('does not fall back to a content read after Stop retires a collection lookup', async () => {
    const held = holdLookup('api/v1/queue/plex:pending');
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    await dispatchQueueOp({ op: 'play-now', contentId: 'plex:pending', clearRest: true });
    await dispatchQueueOp({ op: 'stop' });
    await act(async () => held.reject(new Error('Collection unavailable')));

    expect(DaylightAPI.mock.calls.some(([url]) => url === 'api/v1/play/plex:pending')).toBe(false);
    expect(ref.current.getNowPlaying()).toMatchObject({ item: null, stopped: true });
  });

  it('keeps the collection-to-item fallback live across an equivalent source rerender', async () => {
    const collection = holdLookup('api/v1/queue/plex:pending');
    const item = holdLookup('api/v1/play/plex:pending');
    const ref = createRef();
    const { rerender } = render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    await dispatchQueueOp({ op: 'play-now', contentId: 'plex:pending', clearRest: true });
    rerender(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await act(async () => collection.resolve({ items: [] }));
    await act(async () => item.resolve(playDescriptor('plex:pending')));

    expect(ref.current.getNowPlaying().item.contentId).toBe('plex:pending');
  });

  it.each(['play-now', 'play-next'])('lets a newer Play Now supersede a pending %s while Add can finish', async op => {
    const older = holdLookup('api/v1/play/plex:older');
    const newer = holdLookup('api/v1/play/plex:newer');
    const queued = holdLookup('api/v1/play/plex:queued');
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    const onResult = vi.fn();
    await dispatchQueueOp({ op, contentId: 'plex:older', onResult });
    await dispatchQueueOp({ op: 'add', contentId: 'plex:queued' });
    await dispatchQueueOp({ op: 'play-now', contentId: 'plex:newer' });

    await act(async () => older.resolve(playDescriptor('plex:older')));
    expect(ref.current.getNowPlaying().item.contentId).toBe('plex:current');
    expect(onResult).toHaveBeenCalledWith({ ok: false, code: 'PLAYBACK_CHANGED' });
    await act(async () => newer.resolve(playDescriptor('plex:newer')));
    await act(async () => queued.resolve(playDescriptor('plex:queued')));

    expect(ref.current.getNowPlaying().item.contentId).toBe('plex:newer');
    expect(ref.current.getQueueSnapshot().items.map(item => item.contentId)).toEqual(['plex:newer', 'plex:queued']);
  });

  it('lets a pending Add finish in the retained queue after Stop', async () => {
    const queued = holdLookup('api/v1/play/plex:queued');
    const onApplied = vi.fn();
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    await dispatchQueueOp({ op: 'add', contentId: 'plex:queued', onApplied });
    await dispatchQueueOp({ op: 'stop' });
    await act(async () => queued.resolve(playDescriptor('plex:queued')));

    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:queued', queueLength: 2 }));
    expect(ref.current.getNowPlaying()).toMatchObject({ item: null, stopped: true });
  });

  it('reports a retired Add when a different input takes ownership', async () => {
    const queued = holdLookup('api/v1/play/plex:queued');
    const onApplied = vi.fn();
    const onError = vi.fn();
    const ref = createRef();
    const { rerender } = render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    await dispatchQueueOp({ op: 'add', contentId: 'plex:queued', onApplied, onError });
    rerender(<Player ref={ref} play={[{ contentId: 'plex:replacement' }]} />);
    await waitFor(() => expect(ref.current.getNowPlaying().item.contentId).toBe('plex:replacement'));
    await act(async () => queued.resolve(playDescriptor('plex:queued')));

    expect(onApplied).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PLAYBACK_CHANGED' }));
    expect(ref.current.getQueueSnapshot().items.map(item => item.contentId)).toEqual(['plex:replacement']);
  });

  it('retires a deferred Play Now when the same player receives a different input queue', async () => {
    const held = holdLookup('api/v1/play/plex:pending');
    const ref = createRef();
    const { rerender } = render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    await dispatchQueueOp({ op: 'play-now', contentId: 'plex:pending' });
    rerender(<Player ref={ref} play={[{ contentId: 'plex:replacement' }]} />);
    await waitFor(() => expect(ref.current.getNowPlaying().item.contentId).toBe('plex:replacement'));

    await act(async () => held.resolve(playDescriptor('plex:pending')));
    expect(ref.current.getNowPlaying().item.contentId).toBe('plex:replacement');
  });

  it('retires a deferred lookup when a newer player takes foreground ownership', async () => {
    const held = holdLookup('api/v1/play/plex:pending');
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));

    await dispatchQueueOp({ op: 'play-now', contentId: 'plex:pending' });
    const overlay = render(<Player play={[{ contentId: 'plex:foreground' }]} />);
    await waitFor(() => expect(overlay.container.querySelector('[data-content-id]')).toHaveAttribute('data-content-id', 'plex:foreground'));
    overlay.unmount();

    await act(async () => held.resolve(playDescriptor('plex:pending')));
    expect(ref.current.getNowPlaying().item.contentId).toBe('plex:current');
  });

  it('stops the foreground owner while retaining its queue', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[
      { contentId: 'plex:current' },
      { contentId: 'plex:next' },
    ]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(2));
    const before = ref.current.getPlaybackIdentity();
    const retained = ref.current.getQueueSnapshot().items.map((item) => item.queueItemId);

    await act(async () => {
      expect(getPlayerQueueOpRegistry().dispatch({ op: 'stop', commandId: 'stop-1' })).toBe(true);
      await Promise.resolve();
    });

    expect(ref.current.getOwnerState()).toBe('ready');
    expect(ref.current.getQueueSnapshot().items.map((item) => item.queueItemId)).toEqual(retained);
    expect(ref.current.getPlaybackIdentity()).toMatchObject({
      playbackRevision: before.playbackRevision + 1,
      queueRevision: before.queueRevision,
    });
  });

  it('restores a stopped owner on explicit play without replacing its retained queue', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[
      { contentId: 'plex:current' },
      { contentId: 'plex:next' },
    ]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(2));
    const retained = ref.current.getQueueSnapshot().items.map((item) => item.queueItemId);

    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'stop', commandId: 'stop-1' });
      await Promise.resolve();
    });
    const stoppedIdentity = ref.current.getPlaybackIdentity();
    expect(ref.current.getNowPlaying()).toMatchObject({ item: null, stopped: true });

    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'play', commandId: 'play-1' });
      await Promise.resolve();
    });

    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'play', commandId: 'play-2' });
      await Promise.resolve();
    });

    expect(ref.current.getOwnerState()).toBeNull();
    expect(ref.current.getNowPlaying()).toMatchObject({
      item: expect.objectContaining({ contentId: 'plex:current' }),
    });
    expect(ref.current.getQueueSnapshot().items.map((item) => item.queueItemId)).toEqual(retained);
    expect(ref.current.getPlaybackIdentity()).toMatchObject({
      playbackRevision: stoppedIdentity.playbackRevision + 2,
      queueRevision: stoppedIdentity.queueRevision,
    });
    expect(transport.play).toHaveBeenCalledTimes(2);
    expect(transport.toggle).not.toHaveBeenCalled();
  });

  it('keeps a stopped owner stopped on duplicate explicit pause', async () => {
    const ref = createRef();
    render(<Player ref={ref} play={[{ contentId: 'plex:current' }]} />);
    await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));
    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'stop' });
      await Promise.resolve();
    });
    const stoppedIdentity = ref.current.getPlaybackIdentity();

    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'pause' });
      await Promise.resolve();
    });
    await act(async () => {
      getPlayerQueueOpRegistry().dispatch({ op: 'pause' });
      await Promise.resolve();
    });

    expect(ref.current.getOwnerState()).toBe('ready');
    expect(ref.current.getNowPlaying()).toMatchObject({ item: null, stopped: true });
    expect(ref.current.getPlaybackIdentity()).toMatchObject({
      playbackRevision: stoppedIdentity.playbackRevision + 2,
    });
    expect(transport.pause).toHaveBeenCalledTimes(2);
    expect(transport.toggle).not.toHaveBeenCalled();
  });
  describe('go-live', () => {
    const goLive = async (play) => {
      const errors = [];
      const off = getActionBus().subscribe('command-handler-error', (e) => errors.push(e));
      const ref = createRef();
      render(<Player ref={ref} play={play} />);
      await waitFor(() => expect(ref.current?.getQueueSnapshot().items).toHaveLength(1));
      await act(async () => {
        getPlayerQueueOpRegistry().dispatch({ op: 'go-live', commandId: 'gl-1' });
        await Promise.resolve();
      });
      off?.();
      return errors;
    };

    it('refuses a VOD item with NOT_LIVE instead of seeking it to its end', async () => {
      resetActionBus();
      const errors = await goLive([{ contentId: 'plex:movie' }]);
      expect(errors).toEqual([expect.objectContaining({ commandId: 'gl-1', code: 'NOT_LIVE' })]);
    });

    it('does not answer NOT_LIVE for a live item', async () => {
      resetActionBus();
      const errors = await goLive([{ contentId: 'cam:live-1', isLive: true }]);
      expect(errors.map((e) => e.code)).not.toContain('NOT_LIVE');
    });
  });
});
