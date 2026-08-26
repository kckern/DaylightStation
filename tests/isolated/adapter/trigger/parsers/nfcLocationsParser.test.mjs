import { describe, it, expect } from 'vitest';
import { parseNfcLocations } from '#adapters/trigger/parsers/nfcLocationsParser.mjs';

describe('parseNfcLocations', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parseNfcLocations(null)).toEqual({});
    expect(parseNfcLocations(undefined)).toEqual({});
    expect(parseNfcLocations({})).toEqual({});
  });

  it('parses a minimal location with target+action', () => {
    const result = parseNfcLocations({
      livingroom: { target: 'livingroom-tv', action: 'play-next' },
    });
    expect(result.livingroom).toEqual({
      target: 'livingroom-tv',
      action: 'play-next',
      learner_action: null,
      auth_token: null,
      notify_unknown: null,
      end: null,
      end_location: null,
      defaults: {},
    });
  });

  it('separates reserved fields (target/action/auth_token) from defaults', () => {
    const result = parseNfcLocations({
      bedroom: {
        target: 'bedroom-tv',
        action: 'play-next',
        auth_token: 'secret',
        shader: 'blackout',
        volume: 8,
      },
    });
    expect(result.bedroom.target).toBe('bedroom-tv');
    expect(result.bedroom.action).toBe('play-next');
    expect(result.bedroom.auth_token).toBe('secret');
    expect(result.bedroom.defaults).toEqual({ shader: 'blackout', volume: 8 });
  });

  it('throws when location is not an object', () => {
    expect(() => parseNfcLocations({ livingroom: 'oops' }))
      .toThrow(/location "livingroom".*object/i);
  });

  it('throws when location has no target', () => {
    expect(() => parseNfcLocations({ livingroom: { action: 'play' } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('throws when target is not a non-empty string', () => {
    expect(() => parseNfcLocations({ livingroom: { target: '' } }))
      .toThrow(/location "livingroom".*target/i);
    expect(() => parseNfcLocations({ livingroom: { target: 123 } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('defaults auth_token to null when omitted', () => {
    const result = parseNfcLocations({
      kitchen: { target: 'kitchen-display', action: 'open' },
    });
    expect(result.kitchen.auth_token).toBeNull();
  });

  it('defaults action to null when omitted', () => {
    const result = parseNfcLocations({
      kitchen: { target: 'kitchen-display' },
    });
    expect(result.kitchen.action).toBeNull();
  });

  it('extracts notify_unknown as a top-level field, not a default', () => {
    const result = parseNfcLocations({
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        notify_unknown: 'mobile_app_kc_phone',
        shader: 'default',
      },
    });
    expect(result.livingroom.notify_unknown).toBe('mobile_app_kc_phone');
    expect(result.livingroom.defaults).toEqual({ shader: 'default' });
  });

  it('defaults notify_unknown to null when omitted', () => {
    const result = parseNfcLocations({
      livingroom: { target: 'livingroom-tv' },
    });
    expect(result.livingroom.notify_unknown).toBeNull();
  });

  it('extracts learner_action as first-class config, not a tag default', () => {
    const out = parseNfcLocations({
      livingroom: { target: 'livingroom-tv', action: 'play-next', learner_action: 'reading-session' },
    });
    expect(out.livingroom.learner_action).toBe('reading-session');
    expect(out.livingroom.defaults).not.toHaveProperty('learner_action');
  });

  it('defaults learner_action to null when the location does not declare one', () => {
    const out = parseNfcLocations({ office: { target: 'office-tv' } });
    expect(out.office.learner_action).toBeNull();
  });
});

describe('parseNfcLocations — learner_action validation', () => {
  // An empty string is the dangerous one: it reads as "declared" to a human
  // scanning the YAML but is falsy to the resolver, so the reader silently
  // behaves as if it had no learner_action at all. Refuse it here so
  // `!learner_action` downstream can only ever mean "not declared".
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a number', 7],
    ['a list', ['print-agenda']],
    ['a map', { action: 'print-agenda' }],
  ])('throws INVALID_LEARNER_ACTION when learner_action is %s', (_label, value) => {
    expect(() => parseNfcLocations({ study: { target: 'portal', learner_action: value } }))
      .toThrow(/learner_action/i);
  });

  it('accepts an explicit null as "no learner action here"', () => {
    const out = parseNfcLocations({ study: { target: 'portal', learner_action: null } });
    expect(out.study.learner_action).toBeNull();
  });
});

// The validation trimmed; the write did not. `learner_action: ' print-agenda '`
// therefore passed the guard and became an action no handler could ever be
// keyed by — a whitespace-only mismatch that reads as correct in the YAML and
// as a named refusal at the reader, pointing at nothing.
describe('parseNfcLocations — learner_action whitespace', () => {
  it('stores the trimmed learner_action, not the raw one it validated', () => {
    const out = parseNfcLocations({ study: { target: 'portal', learner_action: '  print-agenda  ' } });
    expect(out.study.learner_action).toBe('print-agenda');
  });
});

