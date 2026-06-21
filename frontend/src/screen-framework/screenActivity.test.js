import { describe, it, expect } from 'vitest';
import { isContentActive, BROWSE_NAV_TYPES } from './screenActivity.js';

describe('isContentActive', () => {
  it('is false on the bare dashboard (no nav content, no overlay)', () => {
    expect(isContentActive(null, false)).toBe(false);
  });
  it('is false for browse surfaces (menu / views)', () => {
    for (const type of ['menu', 'plex-menu', 'show-view', 'season-view']) {
      expect(isContentActive({ type }, false), type).toBe(false);
    }
  });
  it('is true for content surfaces (player / app / etc.)', () => {
    for (const type of ['player', 'app', 'display', 'launch', 'android-launch']) {
      expect(isContentActive({ type }, false), type).toBe(true);
    }
  });
  it('is true whenever a fullscreen overlay is up, regardless of nav content', () => {
    expect(isContentActive(null, true)).toBe(true);
    expect(isContentActive({ type: 'menu' }, true)).toBe(true);
  });
  it('exports the browse type set', () => {
    expect(BROWSE_NAV_TYPES.has('menu')).toBe(true);
    expect(BROWSE_NAV_TYPES.has('player')).toBe(false);
  });
});
