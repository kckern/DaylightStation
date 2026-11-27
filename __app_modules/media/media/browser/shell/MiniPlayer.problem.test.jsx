// RELY.5a/AC3 — the handle shows a problem sign until playback recovers.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// The handle's house menu (Mantine) is covered in house/HouseQuietControls.test.jsx.
vi.mock("../house/HouseQuietControls.jsx", () => ({ HandleHouseMenu: () => null }));
vi.mock("./NavProvider.jsx", () => ({ useNav: () => ({ push: vi.fn(), view: 'home' }) }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { createLocalSessionController } from "../session/LocalSessionController.js";
import { MiniPlayer } from "./MiniPlayer.jsx";

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'audio', title, duration: 600, priority: 'queue', addedAt: '' });

describe('MiniPlayer problem sign', () => {
  it('updates and clears the problem sign without a session snapshot change', () => {
    const controller = createLocalSessionController({ clientId: 'c1' });
    controller.queue.playNow({ contentId: 'plex:1', format: 'video', title: 'Arrival', duration: 600 });
    const snapshot = controller.getSnapshot();
    const unsubscribe = vi.fn();
    const originalSubscribe = controller.problems.subscribe;
    const subscribe = vi.spyOn(controller.problems, 'subscribe').mockImplementation(listener => {
      const dispose = originalSubscribe(listener);
      return () => { dispose(); unsubscribe(); };
    });
    const view = render(<MantineProvider><LocalSessionContext.Provider value={{ controller }}><MiniPlayer /></LocalSessionContext.Provider></MantineProvider>);
    const name = 'Playback problem: waiting for the file of Arrival';
    expect(screen.queryByRole('img', { name })).toBeNull();

    act(() => { controller.onPlayerHeld({ reason: 'source-unavailable' }); });
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(screen.getByRole('img', { name })).toBeInTheDocument();
    expect(screen.getByTestId('media-mini-player')).toHaveClass('mini-player--problem');

    act(() => { controller.problems.clear(); });
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(screen.queryByRole('img', { name })).toBeNull();
    expect(screen.getByTestId('media-mini-player')).not.toHaveClass('mini-player--problem');
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(subscribe.mock.calls.length);
    controller.disposeRecovery();
  });

  it('a video held after its stream failed on a readable file reads "stopped loading", not "waiting for the file"', () => {
    const controller = createLocalSessionController({ clientId: 'c1' });
    controller.queue.playNow({ contentId: 'plex:1', format: 'video', title: 'Arrival', duration: 600 });
    render(<MantineProvider><LocalSessionContext.Provider value={{ controller }}><MiniPlayer /></LocalSessionContext.Provider></MantineProvider>);
    act(() => { controller.onPlayerHeld({ reason: 'media-error-unplayable' }); });
    expect(screen.getByTestId('mini-problem')).toHaveAccessibleName('Playback problem: Arrival stopped loading');
    controller.disposeRecovery();
  });

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
    render(<MantineProvider><LocalSessionContext.Provider value={{ controller }}><MiniPlayer /></LocalSessionContext.Provider></MantineProvider>);
    expect(screen.queryByTestId('mini-problem')).toBeNull();
    act(() => { controller.transport.play(); controller.onPlayerStalled({ stalledMs: 10000 }); });
    const sign = screen.getByTestId('mini-problem');
    expect(sign).toHaveAccessibleName(/Arrival/);
    expect(screen.getByTestId('media-mini-player')).toHaveClass('mini-player--problem');
    act(() => { controller.onPlayerStateChange('playing', 'plex:2'); });
    expect(screen.queryByTestId('mini-problem')).toBeNull();
  });
});
