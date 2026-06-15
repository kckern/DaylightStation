import { describe, it, expect } from 'vitest';
import { resolvePreset } from '../../../backend/src/1_adapters/content/art/presetResolver.mjs';

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
  it('unknown key → inline props only', () => {
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
