import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, cleanup } from '@testing-library/react';

const { musicNext, musicPrev, musicToggle, musicSeek } = vi.hoisted(() => ({
  musicNext: vi.fn(), musicPrev: vi.fn(), musicToggle: vi.fn(), musicSeek: vi.fn(),
}));
vi.mock('../../../frontend/src/lib/Player/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({ track: null, next: musicNext, prev: musicPrev, toggle: musicToggle, seek: musicSeek }),
}));
const apiCalls = [];
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn((u) => { apiCalls.push(String(u)); return new Promise(() => {}); }),
  DaylightMediaPath: (p) => `/${p}`,
}));
const { logInfo } = vi.hoisted(() => ({ logInfo: vi.fn() }));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: logInfo, warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: vi.fn() }));

import ArtMode from '../../../frontend/src/screen-framework/widgets/ArtMode.jsx';
import { getActionBus } from '../../../frontend/src/screen-framework/input/ActionBus.js';

const featuredCalls = () => apiCalls.filter((u) => u.includes('art/featured')).length;

describe('ArtMode controls', () => {
  beforeEach(() => {
    apiCalls.length = 0;
    musicNext.mockClear(); musicPrev.mockClear(); musicToggle.mockClear(); musicSeek.mockClear();
    logInfo.mockClear();
  });
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

  it('media:playback "fwd" scrubs forward within the song (no skip, no art reload)', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} />);
    const before = featuredCalls();
    act(() => getActionBus().emit('media:playback', { command: 'fwd' }));
    expect(musicSeek).toHaveBeenCalledTimes(1);
    expect(musicSeek).toHaveBeenCalledWith(15);
    expect(musicNext).not.toHaveBeenCalled();
    expect(featuredCalls()).toBe(before);          // same song & artwork
  });

  it('media:playback "rew" scrubs backward within the song', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} />);
    act(() => getActionBus().emit('media:playback', { command: 'rew' }));
    expect(musicSeek).toHaveBeenCalledWith(-15);
    expect(musicPrev).not.toHaveBeenCalled();
  });

  it('media:playback "pause" toggles the music', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} />);
    act(() => getActionBus().emit('media:playback', { command: 'pause' }));
    expect(musicToggle).toHaveBeenCalledTimes(1);
    expect(musicNext).not.toHaveBeenCalled();
    expect(musicSeek).not.toHaveBeenCalled();
  });

  it('media:rate cycles the view mode (no song skip, no art reload)', () => {
    render(<ArtMode placard={false} collection="americana" music={{ queue: 'q' }} />);
    const before = featuredCalls();
    logInfo.mockClear();
    act(() => getActionBus().emit('media:rate', {}));
    expect(logInfo).toHaveBeenCalledWith('artmode.viewmode', { dir: 'next', via: 'rate' });
    expect(musicNext).not.toHaveBeenCalled();
    expect(musicSeek).not.toHaveBeenCalled();
    expect(featuredCalls()).toBe(before);
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
