import { describe, it, expect } from 'vitest';
import { provenancePolicy, parseLive } from './provenance.mjs';

describe('provenance policy: live channels', () => {
  it('reads the live block', () => {
    expect(parseLive({ sources: ['plex-live'], provider: 'plex-live-tv', label: 'Plex Live TV' }))
      .toEqual({ sources: ['plex-live'], provider: 'plex-live-tv', label: 'Plex Live TV' });
    expect(provenancePolicy({ live: { sources: ['Plex-Live'], provider: 'plex-live-tv' } }).live)
      .toEqual({ sources: ['plex-live'], provider: 'plex-live-tv', label: null });
  });

  it('is off without a source or a usable provider id', () => {
    expect(provenancePolicy({}).live).toBeNull();
    expect(parseLive({ provider: 'plex-live-tv' })).toBeNull();
    expect(parseLive({ sources: ['plex-live'] })).toBeNull();
    expect(parseLive({ sources: ['plex-live'], provider: '../x' })).toBeNull();
    expect(parseLive({ sources: ['bad source!'], provider: 'p' })).toBeNull();
  });
});
