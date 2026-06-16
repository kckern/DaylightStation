import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Controllable background-music track.
let currentTrack = null;
vi.mock('../../../frontend/src/lib/Player/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({ track: currentTrack }),
}));

// Record art-fetch calls; never resolve (we only assert the call, not the render).
const apiCalls = [];
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn((u) => { apiCalls.push(String(u)); return new Promise(() => {}); }),
  DaylightMediaPath: (p) => `/${p}`,
}));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: vi.fn(),
}));

import ArtMode from '../../../frontend/src/screen-framework/widgets/ArtMode.jsx';

const featuredCalls = () => apiCalls.filter((u) => u.includes('art/featured')).length;

describe('ArtMode advance mode', () => {
  beforeEach(() => { apiCalls.length = 0; currentTrack = null; });

  it('advance:track picks a new artwork on each track change after the first', () => {
    const { rerender } = render(<ArtMode placard={false} advance="track" collection="americana" />);
    expect(featuredCalls()).toBe(1);            // mount load
    currentTrack = { title: 'Song A', artist: 'X' };
    rerender(<ArtMode placard={false} advance="track" collection="americana" />);
    expect(featuredCalls()).toBe(1);            // first track keeps the mount artwork
    currentTrack = { title: 'Song B', artist: 'X' };
    rerender(<ArtMode placard={false} advance="track" collection="americana" />);
    expect(featuredCalls()).toBe(2);            // new track -> new artwork
    currentTrack = { title: 'Song C', artist: 'X' };
    rerender(<ArtMode placard={false} advance="track" collection="americana" />);
    expect(featuredCalls()).toBe(3);
  });

  it('advance:hold (default) never reloads on track change', () => {
    const { rerender } = render(<ArtMode placard={false} collection="americana" />);
    expect(featuredCalls()).toBe(1);
    currentTrack = { title: 'Song A', artist: 'X' };
    rerender(<ArtMode placard={false} collection="americana" />);
    currentTrack = { title: 'Song B', artist: 'X' };
    rerender(<ArtMode placard={false} collection="americana" />);
    expect(featuredCalls()).toBe(1);            // static: held
  });
});
