import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUrlCommand, URL_TOKEN_KEY } from './useUrlCommand.js';

function makeController() {
  return {
    snapshot: { state: 'idle', currentItem: null },
    queue: { playNow: vi.fn(), add: vi.fn() },
    config: { setShuffle: vi.fn(), setShader: vi.fn(), setVolume: vi.fn() },
  };
}

describe('useUrlCommand', () => {
  beforeEach(() => { localStorage.clear(); });

  it('invokes queue.playNow for ?play=<contentId>', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?play=plex-main:12345'));
    expect(ctl.queue.playNow).toHaveBeenCalledWith({ contentId: 'plex-main:12345' }, { clearRest: true });
  });

  it('invokes queue.add for ?queue=<contentId>', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?queue=plex:555'));
    expect(ctl.queue.add).toHaveBeenCalledWith({ contentId: 'plex:555' });
  });

  it('applies ?shuffle=1, ?shader=dark, ?volume=0.5 as config patches', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?play=plex:1&shuffle=1&shader=dark&volume=0.5'));
    expect(ctl.config.setShuffle).toHaveBeenCalledWith(true);
    expect(ctl.config.setShader).toHaveBeenCalledWith('dark');
    expect(ctl.config.setVolume).toHaveBeenCalledWith(50); // 0.5 * 100
  });

  it('ignores duplicate URL command on remount (dedupe token)', () => {
    const ctl1 = makeController();
    renderHook(() => useUrlCommand(ctl1, '?play=plex:1'));
    expect(ctl1.queue.playNow).toHaveBeenCalledTimes(1);

    const ctl2 = makeController();
    renderHook(() => useUrlCommand(ctl2, '?play=plex:1'));
    expect(ctl2.queue.playNow).not.toHaveBeenCalled();
  });

  it('rejects remote-dispatch params silently (device=...)', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?play=plex:1&device=livingroom-tv'));
    expect(ctl.queue.playNow).toHaveBeenCalled(); // play still honored
  });

  it('does nothing when search is empty', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, ''));
    expect(ctl.queue.playNow).not.toHaveBeenCalled();
    expect(ctl.queue.add).not.toHaveBeenCalled();
  });
});

// Audit P1#3: the dedupe token must cover ONLY the playback namespace —
// nav params change as the user navigates, and a raw-search token replayed
// ?play on reload-after-navigation, destroying the session.
import { tokenFor } from './useUrlCommand.js';

describe('tokenFor', () => {
  it('is identical with and without nav params', () => {
    expect(tokenFor('?play=plex:1')).toBe(tokenFor('?play=plex:1&view=fleet'));
    expect(tokenFor('?play=plex:1&view=browse&path=plex/video')).toBe(tokenFor('?play=plex:1'));
  });

  it('differs when playback params differ', () => {
    expect(tokenFor('?play=plex:1')).not.toBe(tokenFor('?play=plex:2'));
    expect(tokenFor('?play=plex:1')).not.toBe(tokenFor('?play=plex:1&shuffle=1'));
  });
});
