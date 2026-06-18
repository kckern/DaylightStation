import { describe, it, expect } from 'vitest';
import { resolvePreset, expandFrame } from '../../../backend/src/1_adapters/content/art/presetResolver.mjs';

const presets = {
  'gallery-silent': { collection: 'all', music: null, matMargin: 4 },
  'classical-evening': { collection: 'all', music: { queue: 'plex:1' }, matMargin: 4 },
};

describe('resolvePreset', () => {
  it('returns the named preset when no inline props', () => {
    expect(resolvePreset(presets, 'gallery-silent')).toEqual({ collection: 'all', music: null, matMargin: 4 });
  });
  it('inline props override the preset per key (shallow)', () => {
    expect(resolvePreset(presets, 'gallery-silent', { matMargin: 6 }))
      .toEqual({ collection: 'all', music: null, matMargin: 6 });
  });
  it('unknown key (no catalogs) → inline props only', () => {
    expect(resolvePreset(presets, 'nope', { matMargin: 6 })).toEqual({ matMargin: 6 });
  });
  it('no key → inline props only', () => {
    expect(resolvePreset(presets, undefined, { matMargin: 6 })).toEqual({ matMargin: 6 });
    expect(resolvePreset(presets, null)).toEqual({});
  });
  it('does not mutate the stored preset', () => {
    resolvePreset(presets, 'gallery-silent', { matMargin: 9 });
    expect(presets['gallery-silent'].matMargin).toBe(4);
  });
});

describe('resolvePreset — defaults / frames / collections', () => {
  const insets = { top: 11, right: 6, bottom: 11, left: 7 };
  const opts = {
    defaults: { frame: 'gold', placard: true },
    frames: { gold: { insets, matMargin: 4, cropMaxPerSide: 8 } },
    collections: { baroque: { dateMin: 1600 }, paintings: {} },
  };
  const tiny = { 'gallery-silent': { collection: 'paintings' } };

  it('merges defaults beneath the preset and expands the named frame', () => {
    expect(resolvePreset(tiny, 'gallery-silent', {}, opts)).toEqual({
      collection: 'paintings', placard: true, frame: insets, matMargin: 4, cropMaxPerSide: 8,
    });
  });
  it('collection-fallback: a bare collection name resolves as { collection }', () => {
    expect(resolvePreset(tiny, 'baroque', {}, opts)).toEqual({
      collection: 'baroque', placard: true, frame: insets, matMargin: 4, cropMaxPerSide: 8,
    });
  });
  it('a key matching neither preset nor collection → defaults + inline only', () => {
    expect(resolvePreset(tiny, 'nope', { matMargin: 6 }, opts)).toEqual({
      placard: true, frame: insets, matMargin: 6, cropMaxPerSide: 8,
    });
  });
  it('inline props win over preset, defaults, and the frame-supplied mat', () => {
    expect(resolvePreset(tiny, 'baroque', { matMargin: 9 }, opts).matMargin).toBe(9);
  });
});

describe('expandFrame', () => {
  const frames = { gold: { insets: { top: 1, right: 2, bottom: 3, left: 4 }, matMargin: 5, cropMaxPerSide: 7 } };
  it('expands a string frame name into insets + fills mat/crop', () => {
    expect(expandFrame({ frame: 'gold' }, frames)).toEqual({
      frame: { top: 1, right: 2, bottom: 3, left: 4 }, matMargin: 5, cropMaxPerSide: 7,
    });
  });
  it('does not overwrite an explicit matMargin/cropMaxPerSide', () => {
    expect(expandFrame({ frame: 'gold', matMargin: 99 }, frames))
      .toMatchObject({ matMargin: 99, cropMaxPerSide: 7 });
  });
  it('leaves an inline insets object (non-string frame) untouched', () => {
    const inset = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(expandFrame({ frame: inset }, frames).frame).toBe(inset);
  });
  it('unknown frame name is left as-is for the widget default', () => {
    expect(expandFrame({ frame: 'missing' }, frames)).toEqual({ frame: 'missing' });
  });
});
