import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, cleanup } from '@testing-library/react';

const { musicNext, musicPrev } = vi.hoisted(() => ({ musicNext: vi.fn(), musicPrev: vi.fn() }));
vi.mock('../../../frontend/src/lib/Player/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({ track: null, next: musicNext, prev: musicPrev }),
}));
const apiCalls = [];
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn((u) => { apiCalls.push(String(u)); return new Promise(() => {}); }),
  DaylightMediaPath: (p) => `/${p}`,
}));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: vi.fn() }));

import ArtMode from '../../../frontend/src/screen-framework/widgets/ArtMode.jsx';
import { getActionBus } from '../../../frontend/src/screen-framework/input/ActionBus.js';

const featuredCalls = () => apiCalls.filter((u) => u.includes('art/featured')).length;

describe('ArtMode controls', () => {
  beforeEach(() => { apiCalls.length = 0; musicNext.mockClear(); musicPrev.mockClear(); });
  afterEach(() => cleanup());

  it('media:playback "next" advances song and art', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} />);
    const before = featuredCalls();
    act(() => getActionBus().emit('media:playback', { command: 'next' }));
    expect(musicNext).toHaveBeenCalledTimes(1);
    expect(featuredCalls()).toBe(before + 1);     // advance:'hold' → art reloaded too
  });

  it('media:playback "prev" steps backward', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} />);
    act(() => getActionBus().emit('media:playback', { command: 'prev' }));
    expect(musicPrev).toHaveBeenCalledTimes(1);
    expect(musicNext).not.toHaveBeenCalled();
  });

  it('rawKeys:false ignores companion nav keys (no view-mode/shuffle hijack)', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} rawKeys={false} />);
    const before = featuredCalls();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })));
    expect(featuredCalls()).toBe(before);         // no art reload from raw keys
    expect(musicNext).not.toHaveBeenCalled();
  });

  it('rawKeys default true: ArrowRight advances song and art', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} />);
    const before = featuredCalls();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    expect(musicNext).toHaveBeenCalledTimes(1);
    expect(featuredCalls()).toBe(before + 1);
  });
});
