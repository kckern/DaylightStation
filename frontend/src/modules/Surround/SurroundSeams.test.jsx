import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { registerSurroundModule } from './registry.js';

/**
 * Seam coverage for Task 16.
 *
 * The original design wrapped only `ScreenPlayer` — and menu-selected playback,
 * which is how the living room actually starts most things, mounts a raw
 * `Player` from `MenuStack` and would silently never frame. Both seams are
 * asserted here, from the outside, through a mocked Player. If either wrapper is
 * removed, exactly one of these tests goes red and names which seam.
 */

const h = vi.hoisted(() => ({ item: null, media: null }));

vi.mock('../Player/Player.jsx', async () => {
  const React = await import('react');
  const Player = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      getNowPlaying: () => ({ item: h.item, isQueue: false }),
      getMediaElement: () => h.media,
    }), []);
    return <video data-testid="the-player" />;
  });
  Player.displayName = 'MockPlayer';
  return {
    default: Player,
    Player,
    PlayerOverlayLoading: () => <div data-testid="player-loading" />,
  };
});

vi.mock('../../context/useMenuNavigationContext.js', () => ({
  useMenuNavigationContext: () => h.nav,
  MenuNavigationProvider: ({ children }) => children,
}));

vi.mock('../../screen-framework/overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({
    registerEscapeInterceptor: vi.fn(),
    unregisterEscapeInterceptor: vi.fn(),
    dismissOverlay: vi.fn(),
  }),
  ScreenOverlayProvider: ({ children }) => children,
}));

const DEFINITION = { id: 'concert-hall', regions: { bottom: [{ module: 'seam-map', height: 60 }] } };
const SURROUND = {
  id: 'concert-hall',
  definition: DEFINITION,
  piece: { title: 'Symphony No. 3' },
  pieceSegments: [],
  cues: [],
  facts: [],
  composer: { name: 'Beethoven' },
  assetBase: 'surround/classical',
};

const SeamModule = () => <div data-testid="seam-module" />;

/** Let the lazy chunk resolve and the 1Hz poll fire at least once. */
const settle = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
};

describe('surround seams', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.item = null;
    h.media = null;
    h.nav = { currentContent: null, depth: 0, push: vi.fn(), pop: vi.fn(), reset: vi.fn() };
    registerSurroundModule('seam-map', SeamModule);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  describe('ScreenPlayer (WS + URL playback)', () => {
    it('frames the player when the now-playing item is enriched', async () => {
      h.item = { id: 'plex:663134', surround: SURROUND };
      const { ScreenPlayer } = await import('../../screen-framework/publishers/ScreenPlayer.jsx');

      const { container } = render(<ScreenPlayer play={{ plex: '663134' }} />);
      await settle();

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
      const media = container.querySelector('[data-testid="surround-media"]');
      expect(media.querySelector('[data-testid="the-player"]')).toBeTruthy();
    });

    it('renders the bare player when the item is not enriched', async () => {
      h.item = { id: 'plex:900001' };
      const { ScreenPlayer } = await import('../../screen-framework/publishers/ScreenPlayer.jsx');

      const { container } = render(<ScreenPlayer play={{ plex: '900001' }} />);
      await settle();

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();
      // The shell is always in the tree (constant depth keeps the player from
      // remounting when a frame engages), but it generates no box, so an
      // un-enriched item lays out exactly like a bare player.
      const video = container.querySelector('[data-testid="the-player"]');
      expect(video).toBeTruthy();
      for (let el = video.parentElement; el && el !== container; el = el.parentElement) {
        expect(el.style.display).toBe('contents');
        expect(el.className).toBe('');
      }
    });
  });

  describe('MenuStack (menu-selected playback)', () => {
    it('frames the player for a menu-selected item (case: player)', async () => {
      h.item = { id: 'plex:663134', surround: SURROUND };
      h.nav = {
        currentContent: { type: 'player', props: { play: { plex: '663134' } } },
        depth: 1, push: vi.fn(), pop: vi.fn(), reset: vi.fn(),
      };
      const { MenuStack } = await import('../Menu/MenuStack.jsx');
      const playerRef = React.createRef();

      const { container } = render(<MenuStack rootMenu="root" playerRef={playerRef} />);
      await settle();

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
      expect(
        container.querySelector('[data-testid="surround-media"] [data-testid="the-player"]'),
      ).toBeTruthy();
    });

    it('frames the player for a composite menu selection (case: composite)', async () => {
      h.item = { id: 'plex:663134', surround: SURROUND };
      h.nav = {
        currentContent: { type: 'composite', props: { play: { plex: '663134' } } },
        depth: 1, push: vi.fn(), pop: vi.fn(), reset: vi.fn(),
      };
      const { MenuStack } = await import('../Menu/MenuStack.jsx');
      const playerRef = React.createRef();

      const { container } = render(<MenuStack rootMenu="root" playerRef={playerRef} />);
      await settle();

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
    });

    it('still plays with no forwarded playerRef (getter returns null)', async () => {
      h.item = { id: 'plex:663134', surround: SURROUND };
      h.nav = {
        currentContent: { type: 'player', props: { play: { plex: '663134' } } },
        depth: 1, push: vi.fn(), pop: vi.fn(), reset: vi.fn(),
      };
      const { MenuStack } = await import('../Menu/MenuStack.jsx');

      const { container } = render(<MenuStack rootMenu="root" />);
      await settle();

      expect(container.querySelector('[data-testid="the-player"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();
    });
  });
});
