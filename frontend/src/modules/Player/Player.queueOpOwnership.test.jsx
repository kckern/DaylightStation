import React from 'react';
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
});
