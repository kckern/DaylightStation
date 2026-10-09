import { describe, it, expect } from 'vitest';
import { parseNamedMap } from "../../../../../capabilities/device-dispatch/server/adapters/parsers/namedMapParser.mjs";

describe('parseNamedMap', () => {
  it('returns {} for falsy input', () => {
    expect(parseNamedMap(null, 'responses')).toEqual({});
    expect(parseNamedMap(undefined, 'endpoints')).toEqual({});
  });
  it('passes through a valid name->object map', () => {
    const raw = { 'play-bedtime-red': { kind: 'playback-hub', target: 'red' } };
    expect(parseNamedMap(raw, 'responses')).toEqual(raw);
  });
  it('throws on non-object root and non-object entries', () => {
    expect(() => parseNamedMap('x', 'responses')).toThrow();
    expect(() => parseNamedMap({ a: 'x' }, 'responses')).toThrow();
  });
});
