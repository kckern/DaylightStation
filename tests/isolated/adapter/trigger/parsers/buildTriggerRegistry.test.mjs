import { describe, it, expect } from 'vitest';
import { buildTriggerRegistry } from '#adapters/trigger/parsers/buildTriggerRegistry.mjs';

describe('buildTriggerRegistry', () => {
  it('returns empty registry when no blobs supplied', () => {
    const result = buildTriggerRegistry({});
    expect(result).toEqual({ nfc: { locations: {}, tags: {} }, state: { locations: {} } });
  });

  it('builds a complete registry from all three blobs', () => {
    const result = buildTriggerRegistry({
      nfcLocations: { livingroom: { target: 'livingroom-tv', action: 'play-next' } },
      nfcTags: { '83_8e_68_06': { plex: 620707 } },
      stateLocations: { livingroom: { target: 'livingroom-tv', states: { off: { action: 'clear' } } } },
    });
    expect(result.nfc.locations.livingroom.target).toBe('livingroom-tv');
    expect(result.nfc.tags['83_8e_68_06'].global).toEqual({ plex: 620707 });
    expect(result.state.locations.livingroom.states.off).toEqual({ action: 'clear' });
  });

  it('passes the set of NFC reader IDs to the tags parser', () => {
    // This test catches the cross-reference: tags need to know which keys are
    // valid reader IDs for the override-block disambiguation.
    expect(() => buildTriggerRegistry({
      nfcLocations: { livingroom: { target: 'tv' } },
      nfcTags: {
        'aa_bb': {
          plex: 1,
          livingrm: { shader: 'x' },  // typo
        },
      },
    })).toThrow(/livingrm.*not registered/i);
  });

  it('parses tags successfully when the override key matches a registered reader', () => {
    const result = buildTriggerRegistry({
      nfcLocations: { livingroom: { target: 'tv' } },
      nfcTags: {
        'aa_bb': {
          plex: 1,
          livingroom: { shader: 'blackout' },
        },
      },
    });
    expect(result.nfc.tags['aa_bb'].overrides.livingroom).toEqual({ shader: 'blackout' });
  });

  it('handles the case where nfcTags is non-empty but nfcLocations is empty (no readers)', () => {
    // Edge case: a tag exists but no readers are configured. Tag without
    // overrides is fine; tag with any object-valued field would throw.
    const result = buildTriggerRegistry({
      nfcTags: { 'aa_bb': { plex: 1 } },
    });
    expect(result.nfc.tags['aa_bb'].global).toEqual({ plex: 1 });
  });
});
