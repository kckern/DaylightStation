// RELY.5a/AC3 — the handle shows a problem sign until playback recovers.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ push: vi.fn(), view: 'home' }) }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { MiniPlayer } from './MiniPlayer.jsx';

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'audio', title, duration: 600, priority: 'queue', addedAt: '' });

describe('MiniPlayer problem sign', () => {
  it('shows a problem sign naming the item after a skip and clears when playback recovers', () => {
    const controller = createLocalSessionController({
      clientId: 'c1',
      persistedSnapshot: {
        sessionId: 's', state: 'paused', currentItem: { contentId: 'plex:1', format: 'audio', title: 'Arrival', duration: 600 }, position: 0,
        queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova')], currentIndex: 0, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
      },
    });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    render(<LocalSessionContext.Provider value={{ controller }}><MiniPlayer /></LocalSessionContext.Provider>);
    expect(screen.queryByTestId('mini-problem')).toBeNull();
    act(() => { controller.transport.play(); controller.onPlayerStalled({ stalledMs: 10000 }); });
    const sign = screen.getByTestId('mini-problem');
    expect(sign).toHaveAccessibleName(/Arrival/);
    expect(screen.getByTestId('media-mini-player')).toHaveClass('mini-player--problem');
    act(() => { controller.onPlayerStateChange('playing', 'plex:2'); });
    expect(screen.queryByTestId('mini-problem')).toBeNull();
  });
});
