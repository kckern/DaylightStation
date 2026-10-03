// RELY.5a — a local skip reaches the one outcome system exactly once.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { LocalPlaybackOutcomes } from './LocalPlaybackOutcomes.jsx';

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'audio', title, duration: 600, priority: 'queue', addedAt: '' });

describe('LocalPlaybackOutcomes', () => {
  it('records a skipped item with what plays instead', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: {
      sessionId: 's', state: 'paused', currentItem: { contentId: 'plex:1', format: 'audio', title: 'Arrival', duration: 600 }, position: 0,
      queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova')], currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
    } });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    const recordLocal = vi.fn();
    render(
      <LocalSessionContext.Provider value={{ controller }}>
        <DispatchContext.Provider value={{ recordLocal }}><LocalPlaybackOutcomes /></DispatchContext.Provider>
      </LocalSessionContext.Provider>,
    );
    act(() => { controller.transport.play(); controller.onPlayerStalled({ stalledMs: 10000 }); });
    expect(recordLocal).toHaveBeenCalledTimes(1);
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'playback', phase: 'skipped', reason: 'stalled',
      item: expect.objectContaining({ title: 'Arrival' }), replacement: expect.objectContaining({ title: 'Nova' }),
    }));
  });
});
