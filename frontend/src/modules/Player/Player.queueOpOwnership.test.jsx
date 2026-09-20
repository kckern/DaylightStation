import React, { createRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPlayerQueueOpRegistryForTests,
  getPlayerQueueOpRegistry,
} from './lib/queueOpRegistry.js';

vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: ({ contentId }) => <div data-testid="single-player" data-content-id={contentId} />,
}));

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    const contentId = String(path).replace(/^api\/v1\/play\//, '');
    return { contentId, id: contentId, title: contentId, mediaUrl: `/stream/${contentId}` };
  }),
}));

import Player from './Player.jsx';

describe('Player queue-op ownership integration', () => {
  beforeEach(() => __resetPlayerQueueOpRegistryForTests());
  afterEach(() => cleanup());

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
});
