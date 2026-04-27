import { describe, it, expect } from 'vitest';
import { NfcResolver } from '#domains/trigger/services/NfcResolver.mjs';

const stubResolver = { resolve: () => true }; // every shorthand is valid

function buildRegistry({ end = null, end_location = null, tagFields = {} } = {}) {
  return {
    locations: {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        end,
        end_location,
        defaults: {},
      },
    },
    tags: {
      deadbeef: {
        global: { plex: '620681', ...tagFields },
        overrides: {},
      },
    },
  };
}

describe('NfcResolver — end behavior', () => {
  it('propagates location-level end and end_location onto the intent', () => {
    const intent = NfcResolver.resolve({
      location: 'livingroom',
      value: 'deadbeef',
      registry: buildRegistry({ end: 'tv-off', end_location: 'living_room' }),
      contentIdResolver: stubResolver,
    });
    expect(intent.end).toBe('tv-off');
    expect(intent.endLocation).toBe('living_room');
    expect(intent.params.end).toBeUndefined();
    expect(intent.params.end_location).toBeUndefined();
  });

  it('omits intent.end when no end is configured', () => {
    const intent = NfcResolver.resolve({
      location: 'livingroom',
      value: 'deadbeef',
      registry: buildRegistry({ end: null }),
      contentIdResolver: stubResolver,
    });
    expect(intent.end).toBeUndefined();
    expect(intent.endLocation).toBeUndefined();
  });

  it('treats end:nothing as "no end behavior" (no intent.end)', () => {
    const intent = NfcResolver.resolve({
      location: 'livingroom',
      value: 'deadbeef',
      registry: buildRegistry({ end: 'nothing' }),
      contentIdResolver: stubResolver,
    });
    expect(intent.end).toBeUndefined();
    expect(intent.endLocation).toBeUndefined();
  });

  it('per-tag end overrides location-level end', () => {
    const intent = NfcResolver.resolve({
      location: 'livingroom',
      value: 'deadbeef',
      registry: buildRegistry({
        end: 'tv-off',
        end_location: 'living_room',
        tagFields: { end: 'nothing' },
      }),
      contentIdResolver: stubResolver,
    });
    expect(intent.end).toBeUndefined(); // 'nothing' wins, suppresses end
  });
});
