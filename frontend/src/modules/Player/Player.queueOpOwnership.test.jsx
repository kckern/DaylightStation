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

vi.mock('../../lib/api.mjs', () => ({
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
    const contentId = String(path).replace(/^api\/v1\/play\//, '');
    return {
      contentId, id: contentId, title: contentId, mediaUrl: `/stream/${contentId}`,
      ...(contentId.includes('live') ? { isLive: true } : {}),
    };
  }),
}));

import Player from './Player.jsx';
import { getActionBus, resetActionBus } from '../../screen-framework/input/ActionBus.js';

describe('Player queue-op ownership integration', () => {
  beforeEach(() => {
    __resetPlayerQueueOpRegistryForTests();
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
