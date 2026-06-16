import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';

// Controllable background-music track (track-advance drives the curtain swap).
let currentTrack = null;
vi.mock('../../../frontend/src/lib/Player/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({ track: currentTrack, next: vi.fn(), prev: vi.fn() }),
}));

// Each art fetch parks its resolver so the test controls when data arrives.
const resolvers = [];
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => new Promise((res) => resolvers.push(res))),
  DaylightMediaPath: (p) => `/${p}`,
}));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: vi.fn() }));

import ArtMode from '../../../frontend/src/screen-framework/widgets/ArtMode.jsx';

const artFor = (img) => ({ mode: 'single', panels: [{ image: img, meta: { title: img, width: 1600, height: 1000 } }] });
const imgSrc = (c) => c.querySelector('[data-testid="artmode-image"]')?.getAttribute('src');
const props = { placard: false, advance: 'track', collection: 'americana', curtainCloseMs: 1400 };

describe('ArtMode curtain gating', () => {
  beforeEach(() => { currentTrack = null; resolvers.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('holds the matted image until the curtain has closed, even when the API returns fast', async () => {
    const { container, rerender } = render(<ArtMode {...props} />);

    // Mount load resolves with artwork A; the swap commits immediately (curtain
    // starts closed at mount, so there's no close animation to wait on).
    await act(async () => { resolvers[0](artFor('A.jpg')); });
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(imgSrc(container)).toBe('/A.jpg');

    // Part the curtain: the image loads and the minimum dwell elapses.
    await act(async () => {
      fireEvent.load(container.querySelector('[data-testid="artmode-image"]'));
      vi.advanceTimersByTime(2000);
    });

    // The first song keeps the mount artwork (no swap).
    currentTrack = { title: 'Song A' };
    rerender(<ArtMode {...props} />);
    expect(resolvers).toHaveLength(1);
    expect(imgSrc(container)).toBe('/A.jpg');

    // The next song triggers a curtain swap.
    currentTrack = { title: 'Song B' };
    rerender(<ArtMode {...props} />);
    expect(resolvers).toHaveLength(2);

    // The new artwork is already available (fast API) — but the curtain just
    // dropped, so the visible image must still be the previous one.
    await act(async () => { resolvers[1](artFor('B.jpg')); });
    expect(imgSrc(container)).toBe('/A.jpg');

    // Only once the close animation has finished does the swap commit.
    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(imgSrc(container)).toBe('/B.jpg');
  });

  const isOpen = (container) =>
    container.querySelector('[data-testid="artmode-curtain"]').className.includes('artmode__curtain--open');

  // Helper: mount, commit artwork A, and part the curtain so we start each
  // transition test from a fully-OPEN curtain (the state real transitions begin in).
  const mountAndOpen = async (container) => {
    await act(async () => { resolvers[0](artFor('A.jpg')); });
    await act(async () => { vi.advanceTimersByTime(0); });
    await act(async () => {
      fireEvent.load(container.querySelector('[data-testid="artmode-image"]'));
      vi.advanceTimersByTime(2000);
    });
    expect(isOpen(container)).toBe(true);
  };

  it('keeps the curtain shut for the minimum dwell AFTER it finishes closing, not the instant it meets', async () => {
    const { container, rerender } = render(<ArtMode {...props} />);
    await mountAndOpen(container);

    currentTrack = { title: 'Song A' }; rerender(<ArtMode {...props} />);   // first song: no swap
    currentTrack = { title: 'Song B' }; rerender(<ArtMode {...props} />);   // swap → curtain drops
    expect(isOpen(container)).toBe(false);                                  // closing

    await act(async () => { resolvers[1](artFor('B.jpg')); });

    // Advance through the full close animation. The swap commits at close-complete,
    // but the curtain must STILL be shut — it gets a dwell before parting.
    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(imgSrc(container)).toBe('/B.jpg');
    expect(isOpen(container)).toBe(false);

    // New image loads; the reveal honors the min dwell measured from close-complete,
    // so a sub-dwell tick must NOT reopen it. (Pre-fix: opened the instant it met.)
    await act(async () => {
      fireEvent.load(container.querySelector('[data-testid="artmode-image"]'));
      vi.advanceTimersByTime(300);                                         // < curtainMinMs (700)
    });
    expect(isOpen(container)).toBe(false);

    // Once the dwell elapses, it parts.
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(isOpen(container)).toBe(true);
  });

  it('never reopens mid-close when a second transition fires while the first is still closing', async () => {
    const { container, rerender } = render(<ArtMode {...props} />);
    await mountAndOpen(container);

    currentTrack = { title: 'Song A' }; rerender(<ArtMode {...props} />);   // first song: no swap
    currentTrack = { title: 'Song B' }; rerender(<ArtMode {...props} />);   // drop #1 starts close
    expect(isOpen(container)).toBe(false);

    // A second transition fires only 300ms into the 1400ms close (rapid skip).
    await act(async () => { vi.advanceTimersByTime(300); });
    currentTrack = { title: 'Song C' }; rerender(<ArtMode {...props} />);
    expect(resolvers).toHaveLength(3);

    // Both fetches resolve fast.
    await act(async () => { resolvers[1](artFor('B.jpg')); resolvers[2](artFor('C.jpg')); });

    // The original close completes at t≈1400 (1100ms more). The re-trigger must not
    // have shortened the dwell — the curtain stays shut right through close-complete.
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(isOpen(container)).toBe(false);

    // The latest artwork (C) is what surfaces, and only after its dwell does it part.
    await act(async () => {
      const img = container.querySelector('[data-testid="artmode-image"]');
      if (img) fireEvent.load(img);
      vi.advanceTimersByTime(1000);
    });
    expect(imgSrc(container)).toBe('/C.jpg');
    expect(isOpen(container)).toBe(true);
  });
});
