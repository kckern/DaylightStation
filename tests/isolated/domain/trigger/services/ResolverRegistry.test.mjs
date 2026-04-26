import { describe, it, expect } from 'vitest';
import { ResolverRegistry, UnknownModalityError } from '#domains/trigger/services/ResolverRegistry.mjs';

const fakeContentIdResolver = { resolve: (c) => c.startsWith('plex:') };

const fakeRegistry = {
  nfc: {
    locations: {
      livingroom: { target: 'tv', action: 'play', defaults: {} },
    },
    tags: {
      'aa_bb': { global: { plex: 100 }, overrides: {} },
    },
  },
  state: {
    locations: {
      livingroom: { target: 'tv', states: { off: { action: 'clear' } } },
    },
  },
};

describe('ResolverRegistry.resolve', () => {
  it('dispatches nfc to NfcResolver', () => {
    const result = ResolverRegistry.resolve({
      modality: 'nfc',
      location: 'livingroom',
      value: 'aa_bb',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    });
    expect(result?.content).toBe('plex:100');
  });

  it('dispatches state to StateResolver', () => {
    const result = ResolverRegistry.resolve({
      modality: 'state',
      location: 'livingroom',
      value: 'off',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    });
    expect(result?.action).toBe('clear');
  });

  it('throws UnknownModalityError for an unknown modality', () => {
    expect(() => ResolverRegistry.resolve({
      modality: 'voice',
      location: 'livingroom',
      value: 'play_jazz',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    })).toThrow(UnknownModalityError);
  });

  it('returns null when the resolver returns null (e.g. unregistered)', () => {
    const result = ResolverRegistry.resolve({
      modality: 'nfc',
      location: 'unknown',
      value: 'aa_bb',
      registry: fakeRegistry,
      contentIdResolver: fakeContentIdResolver,
    });
    expect(result).toBeNull();
  });
});
