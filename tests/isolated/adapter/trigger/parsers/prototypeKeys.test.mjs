import { describe, it, expect, vi } from 'vitest';
import { parseSources } from '#adapters/trigger/parsers/sourcesParser.mjs';
import { parseNfcLocations } from '#adapters/trigger/parsers/nfcLocationsParser.mjs';
import { parseNfcTags } from '#adapters/trigger/parsers/nfcTagsParser.mjs';
import { parseStateLocations } from '#adapters/trigger/parsers/stateLocationsParser.mjs';
import { parseVoiceLocations } from '#adapters/trigger/parsers/voiceLocationsParser.mjs';
import { parseNamedMap } from '#adapters/trigger/parsers/namedMapParser.mjs';

// A config key of __proto__ / constructor / prototype must never reach an
// assignment like `out[key] = …`: `__proto__` replaces the object's prototype,
// and the others shadow Object members that lookups then trip over. Each is a
// ValidationError (RESERVED_KEY), so lenient loading drops just that entry.
// JSON.parse makes a real own `__proto__` key, as a YAML loader does.
const withKey = (key, value) => JSON.parse(`{${JSON.stringify(key)}: ${JSON.stringify(value)}}`);
const UNSAFE = ['__proto__', 'constructor', 'prototype'];
const reserved = expect.objectContaining({ code: 'RESERVED_KEY' });

describe('trigger parsers reject prototype keys', () => {
  it.each(UNSAFE)('sources: a source id %s', (key) => {
    expect(() => parseSources(withKey(key, { modality: 'nfc', target: 't' }))).toThrow(reserved);
  });

  it.each(UNSAFE)('sources: a location %s', (key) => {
    expect(() => parseSources({ s: { modality: 'nfc', location: key, target: 't' } })).toThrow(reserved);
  });

  it.each(UNSAFE)('nfc locations: a location id %s', (key) => {
    expect(() => parseNfcLocations(withKey(key, { target: 't' }))).toThrow(reserved);
  });

  it.each(UNSAFE)('nfc locations: a defaults key %s', (key) => {
    expect(() => parseNfcLocations({ lr: { target: 't', ...withKey(key, 1) } })).toThrow(reserved);
  });

  it.each(UNSAFE)('nfc tags: a global field %s', (key) => {
    expect(() => parseNfcTags({ '04a1b2c3': { plex: 1, ...withKey(key, 'x') } }, new Set())).toThrow(reserved);
  });

  it.each(UNSAFE)('nfc tags: an override block %s', (key) => {
    expect(() => parseNfcTags({ '04a1b2c3': { plex: 1, ...withKey(key, { action: 'x' }) } }, new Set([key]))).toThrow(reserved);
  });

  it.each(UNSAFE)('state locations: a location id %s', (key) => {
    expect(() => parseStateLocations(withKey(key, { target: 't' }))).toThrow(reserved);
  });

  it.each([...UNSAFE, 'Constructor'])('state locations: a state value %s', (key) => {
    expect(() => parseStateLocations({ lr: { target: 't', states: withKey(key, { action: 'clear' }) } })).toThrow(reserved);
  });

  it.each(UNSAFE)('voice locations: a location id %s', (key) => {
    expect(() => parseVoiceLocations(withKey(key, { target: 't', commands: { stop: { action: 'clear' } } }))).toThrow(reserved);
  });

  it.each(['constructor', 'Constructor', 'prototype'])('voice locations: a command id %s', (key) => {
    expect(() => parseVoiceLocations({ k: { target: 't', commands: withKey(key, { action: 'clear' }) } })).toThrow(reserved);
  });

  it.each(UNSAFE)('named maps: an entry %s', (key) => {
    expect(() => parseNamedMap(withKey(key, { kind: 'content' }), 'responses')).toThrow(reserved);
  });
});

describe('lenient loading drops only the entry with the bad key', () => {
  it('a source keyed constructor is skipped; the rest load', () => {
    const onSkip = vi.fn();
    const out = parseSources({
      livingroom: { modality: 'nfc', target: 'livingroom-tv' },
      constructor: { modality: 'nfc', target: 'x' },
      'hall-state': { modality: 'state', location: 'hall', target: 't', states: { constructor: { action: 'clear' } } },
    }, { onSkip });
    expect(Object.keys(out.nfc.locations)).toEqual(['livingroom']);
    expect(Object.keys(out.state.locations)).toEqual([]);
    expect(onSkip.mock.calls.map(([s]) => [s.id, s.code]).sort()).toEqual([['constructor', 'RESERVED_KEY'], ['hall-state', 'RESERVED_KEY']]);
    expect(Object.getPrototypeOf(out.nfc.locations)).toBe(Object.prototype);
  });

  it('a tag with a __proto__ field is skipped; other tags load', () => {
    const onSkip = vi.fn();
    const tags = parseNfcTags({ '04a1b2c3': { plex: 1 }, '04ffeedd': { plex: 2, ...withKey('__proto__', { polluted: true }) } }, new Set(), { onSkip });
    expect(Object.keys(tags)).toEqual(['04a1b2c3']);
    expect(tags['04a1b2c3'].global.polluted).toBeUndefined();
    expect(onSkip).toHaveBeenCalledWith(expect.objectContaining({ id: '04ffeedd', code: 'RESERVED_KEY' }));
  });
});
