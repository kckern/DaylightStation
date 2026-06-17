import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';

// Favorites slideshow is music-less; the timer drives advances.
vi.mock('../../../frontend/src/lib/Player/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({ track: null, next: vi.fn(), prev: vi.fn() }),
}));

// Each art fetch parks its resolver and records the URL.
const resolvers = [];
const apiCalls = [];
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn((u) => { apiCalls.push(String(u)); return new Promise((res) => resolvers.push(res)); }),
  DaylightMediaPath: (p) => `/${p}`,
}));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: vi.fn() }));

import ArtMode from '../../../frontend/src/screen-framework/widgets/ArtMode.jsx';

const artFor = (img) => ({ mode: 'single', panels: [{ image: img, meta: { title: img, width: 1600, height: 1000 } }] });
const featuredCount = () => apiCalls.filter((u) => u.includes('art/featured')).length;
const layers = (c) => c.querySelectorAll('[data-testid="artmode-layer"]');
const imgIn = (el) => el.querySelector('[data-testid="artmode-image"]');
const props = {
  placard: false, collection: 'favorites',
  transition: 'crossfade', advance: 'timer', intervalSec: 5, crossfadeMs: 1000,
};

describe('ArtMode slideshow (timer + crossfade)', () => {
  beforeEach(() => { resolvers.length = 0; apiCalls.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('fetches on mount and again on every timer tick', async () => {
    render(<ArtMode {...props} />);
    expect(featuredCount()).toBe(1);                       // mount load
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(featuredCount()).toBe(2);                       // first tick
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(featuredCount()).toBe(3);                       // second tick
  });

  it('renders stacked planes and never the velvet curtain', async () => {
    const { container } = render(<ArtMode {...props} />);
    await act(async () => { resolvers[0](artFor('A.jpg')); });
    expect(container.querySelector('[data-testid="artmode-curtain"]')).toBeNull();
    expect(layers(container).length).toBe(1);
  });

  it('reveals a plane only once its art paints, then prunes the one beneath', async () => {
    const { container } = render(<ArtMode {...props} />);

    // Plane A arrives but stays hidden until its image paints.
    await act(async () => { resolvers[0](artFor('A.jpg')); });
    expect(layers(container).length).toBe(1);
    expect(layers(container)[0].className).not.toContain('artmode__layer--visible');
    await act(async () => { fireEvent.load(imgIn(layers(container)[0])); });
    expect(layers(container)[0].className).toContain('artmode__layer--visible');

    // Timer tick → fetch + stack plane B over A.
    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => { resolvers[1](artFor('B.jpg')); });
    expect(layers(container).length).toBe(2);

    // B paints → it reveals; one crossfade later A is pruned, leaving only B.
    await act(async () => { fireEvent.load(imgIn(layers(container)[1])); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    const remaining = layers(container);
    expect(remaining.length).toBe(1);
    expect(imgIn(remaining[0]).getAttribute('src')).toBe('/B.jpg');
  });

  it('curtain transition (default) still renders the curtain, not planes', async () => {
    const { container } = render(<ArtMode placard={false} collection="favorites" />);
    await act(async () => { resolvers[0](artFor('A.jpg')); });
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(container.querySelector('[data-testid="artmode-curtain"]')).not.toBeNull();
    expect(layers(container).length).toBe(0);
  });
});
