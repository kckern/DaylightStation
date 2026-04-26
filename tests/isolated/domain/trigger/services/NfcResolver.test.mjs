import { describe, it, expect } from 'vitest';
import { NfcResolver } from '#domains/trigger/services/NfcResolver.mjs';

const makeContentIdResolver = () => ({
  resolve: (compound) => compound.startsWith('plex:') ? compound : null,
});

const baseRegistry = {
  locations: {
    livingroom: {
      target: 'livingroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: { shader: 'default', volume: 15 },
    },
    bedroom: {
      target: 'bedroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: { shader: 'blackout', volume: 8 },
    },
  },
  tags: {
    '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
    'aa_bb': {
      global: { plex: 100, shader: 'focused' },
      overrides: {
        bedroom: { shader: 'night', volume: 5 },
      },
    },
  },
};

describe('NfcResolver', () => {
  const contentIdResolver = makeContentIdResolver();

  it('returns null when location is not registered', () => {
    const result = NfcResolver.resolve({
      location: 'unknown',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toBeNull();
  });

  it('returns null when tag UID is not registered', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'unknown_tag',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toBeNull();
  });

  it('produces an intent for a minimal tag using reader defaults', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8e_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toEqual({
      action: 'play-next',
      target: 'livingroom-tv',
      content: 'plex:620707',
      params: { shader: 'default', volume: 15 },
    });
  });

  it('merges reader-defaults < tag-global, with tag-global winning on collision', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('focused');
    expect(result.params.volume).toBe(15);
  });

  it('merges reader-defaults < tag-global < tag-override-for-location, with override winning', () => {
    const result = NfcResolver.resolve({
      location: 'bedroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('night');
    expect(result.params.volume).toBe(5);
    expect(result.target).toBe('bedroom-tv');
  });

  it('does not apply overrides for other locations', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('focused');
    expect(result.target).toBe('livingroom-tv');
  });

  it('allows tag-global to override action and target', () => {
    const registry = {
      locations: {
        livingroom: { target: 'livingroom-tv', action: 'play-next', defaults: {} },
      },
      tags: {
        'override_tag': {
          global: { plex: 100, action: 'queue', target: 'kitchen-display' },
          overrides: {},
        },
      },
    };
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'override_tag',
      registry,
      contentIdResolver,
    });
    expect(result.action).toBe('queue');
    expect(result.target).toBe('kitchen-display');
  });

  it('lowercases the input value before lookup', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8E_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result?.content).toBe('plex:620707');
  });

  it('throws when shorthand expansion finds multiple resolvable content prefixes', () => {
    const registry = {
      locations: { livingroom: { target: 'tv', action: 'play', defaults: {} } },
      tags: {
        'ambiguous': { global: { plex: 1, files: 'x' }, overrides: {} },
      },
    };
    // Both `plex:` and `files:` resolve as content per this special resolver.
    const ambiguousResolver = { resolve: (c) => c.startsWith('plex:') || c.startsWith('files:') };
    expect(() => NfcResolver.resolve({
      location: 'livingroom',
      value: 'ambiguous',
      registry,
      contentIdResolver: ambiguousResolver,
    })).toThrow(/shorthand/i);
  });

  it('does not include consumed shorthand key in params', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8e_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.plex).toBeUndefined();
  });
});

describe('NfcResolver — metadata-only tags', () => {
  function makeRegistry(tags = {}) {
    return {
      locations: {
        livingroom: {
          target: 'livingroom-tv',
          action: 'play-next',
          defaults: {},
        },
      },
      tags,
    };
  }
  const resolver = { resolve: (id) => /^plex:/.test(id) ? { source: 'plex' } : null };

  it('returns null for a tag with only scanned_at (placeholder, state 1)', () => {
    const registry = makeRegistry({
      '04_a1_b2_c3': { global: { scanned_at: '2026-04-26 10:00:00' }, overrides: {} },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04_a1_b2_c3',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).toBeNull();
  });

  it('returns null for a tag with scanned_at + note (state 2)', () => {
    const registry = makeRegistry({
      '04_a1_b2_c3': {
        global: { scanned_at: '2026-04-26 10:00:00', note: 'kids movie' },
        overrides: {},
      },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04_a1_b2_c3',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).toBeNull();
  });

  it('returns intent for a scene-only tag (no content, state 3)', () => {
    const registry = makeRegistry({
      '04doorkey1': { global: { scene: 'scene.welcome_home' }, overrides: {} },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04doorkey1',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).not.toBeNull();
    expect(result.scene).toBe('scene.welcome_home');
  });

  it('returns intent for a ha-service tag (no content, state 3)', () => {
    const registry = makeRegistry({
      '04light': { global: { service: 'turn_on', entity: 'light.kitchen' }, overrides: {} },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04light',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).not.toBeNull();
    expect(result.service).toBe('turn_on');
    expect(result.entity).toBe('light.kitchen');
  });
});
