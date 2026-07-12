import { describe, it, expect } from 'vitest';
import { parseSources } from '#adapters/trigger/parsers/sourcesParser.mjs';

describe('parseSources', () => {
  it('partitions nfc and state sources into internal slices', () => {
    const raw = {
      livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next', end: 'tv-off', end_location: 'living_room', notify_unknown: 'mobile_app_kc_phone' },
      'livingroom-state': { modality: 'state', location: 'livingroom', target: 'livingroom-tv', states: { off: { action: 'clear' } } },
    };
    const out = parseSources(raw);
    expect(out.nfc.locations.livingroom).toMatchObject({ target: 'livingroom-tv', action: 'play-next', end: 'tv-off', end_location: 'living_room', notify_unknown: 'mobile_app_kc_phone' });
    expect(out.state.locations.livingroom).toMatchObject({ target: 'livingroom-tv', states: { off: { action: 'clear' } } });
  });

  it('maps guards.authenticate.secret to auth_token and defaults location to the key', () => {
    const out = parseSources({ garage: { modality: 'nfc', target: 'garage-tv', guards: { authenticate: { secret: 'tok123' }, debounce: { windowMs: 5000 } } } });
    expect(out.nfc.locations.garage.auth_token).toBe('tok123');
    expect(out.nfc.locations.garage.debounce_ms).toBe(5000);
  });

  it('throws on non-object root, non-object entry, and unknown modality', () => {
    expect(() => parseSources('x')).toThrow();
    expect(() => parseSources({ a: 'x' })).toThrow();
    expect(() => parseSources({ a: { modality: 'voice', target: 't' } })).toThrow();
  });
});
