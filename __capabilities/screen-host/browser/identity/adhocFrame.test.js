import { describe, it, expect } from 'vitest';
import { routeScreenId, screenFrame, lockPageScroll, ADHOC_SCREEN_ID } from './adhocScreen.js';
import { builtInScreen } from '../../server/application/builtInScreens.mjs';

describe('a bare /screen is the ad-hoc screen', () => {
  it('names adhoc when the URL names no screen', () => {
    expect(routeScreenId(undefined)).toBe(ADHOC_SCREEN_ID);
    expect(routeScreenId('')).toBe('adhoc');
    expect(routeScreenId('  ')).toBe('adhoc');
    expect(routeScreenId('living-room')).toBe('living-room');
  });
});

describe('screenFrame: full-bleed only where asked', () => {
  it('the ad-hoc screen is the whole window: no resolution, margin or letterbox', () => {
    const f = screenFrame(builtInScreen('adhoc'));
    expect(f.fullbleed).toBe(true);
    expect(f.viewportStyle).toMatchObject({ width: '100vw', height: '100dvh', overflow: 'hidden', margin: 0, padding: 0 });
    expect(f.rootSize).toMatchObject({ width: '100%', height: '100%', margin: 0, padding: 0, borderRadius: 0 });
    expect(f.rootClassExtra).toBe(' screen-root--fullbleed');
    expect(f.viewportClass).toContain('screen-viewport--fullbleed');
  });

  it('ignores a resolution on a full-bleed screen', () => {
    const f = screenFrame({ fullbleed: true, resolution: { width: 1280, height: 720 } });
    expect(f.rootSize.width).toBe('100%');
    expect(f.rootSize.height).toBe('100%');
  });

  it('leaves a configured screen as it was: its resolution, centred, 100vh', () => {
    const f = screenFrame({ resolution: { width: 1280, height: 720 }, theme: { 'screen-bg': '#1a1a2e' } });
    expect(f.fullbleed).toBe(false);
    expect(f.rootSize).toEqual({ width: '1280px', height: '720px' });
    expect(f.viewportStyle.height).toBe('100vh');
    expect(f.viewportStyle.backgroundColor).toBe('#1a1a2e');
    expect(f.viewportStyle.margin).toBeUndefined();
    expect(f.rootClassExtra).toBe('');
    expect(f.viewportClass).toBe('screen-viewport');
  });

  it('is calm before a config arrives', () => {
    const f = screenFrame(null);
    expect(f.fullbleed).toBe(false);
    expect(f.viewportStyle.backgroundColor).toBe('#000');
  });
});

describe('lockPageScroll', () => {
  it('stops the page scrolling and puts it back', () => {
    document.body.style.overflow = 'auto';
    document.body.style.margin = '8px';
    const undo = lockPageScroll(document);
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.margin).toBe('0px');
    undo();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.margin).toBe('8px');
  });
  it('is harmless without a document', () => {
    expect(typeof lockPageScroll(null)).toBe('function');
  });
});
