import { describe, it, expect, beforeEach } from 'vitest';
import { registerItemParams, paramsTypeFor, __resetItemParams } from './registry.js';
import { KNOWN_ITEM_FIELDS } from '../listConstants.js';

function charadesType(overrides = {}) {
  return {
    id: 'charades',
    label: 'Charades',
    matches: input => /^app:party-games\/charades:/.test(input),
    summary: p => `${p.participants?.length ?? 0} people`,
    Editor: () => null,
    ...overrides,
  };
}

describe('item params registry', () => {
  beforeEach(() => __resetItemParams());

  it('matches by input and returns the type', () => {
    const type = charadesType();
    registerItemParams(type);
    expect(paramsTypeFor({ input: 'app:party-games/charades:fhe' })).toBe(type);
    expect(paramsTypeFor({ input: 'plex:123' })).toBeNull();
    expect(paramsTypeFor({})).toBeNull();
  });

  it('returns null for a missing item or a non-string input', () => {
    registerItemParams(charadesType());
    expect(paramsTypeFor(null)).toBeNull();
    expect(paramsTypeFor(undefined)).toBeNull();
    expect(paramsTypeFor({ input: 42 })).toBeNull();
  });

  it('returns null when nothing is registered', () => {
    expect(paramsTypeFor({ input: 'app:party-games/charades:fhe' })).toBeNull();
  });

  it('registering the same id twice keeps one entry', () => {
    const first = charadesType();
    const second = charadesType({ label: 'Charades again' });
    registerItemParams(first);
    registerItemParams(second);
    expect(paramsTypeFor({ input: 'app:party-games/charades:fhe' })).toBe(first);
  });

  it('picks the type whose matcher accepts the input', () => {
    const charades = charadesType();
    const pictionary = charadesType({ id: 'pictionary', label: 'Pictionary', matches: i => i.startsWith('app:party-games/pictionary:') });
    registerItemParams(charades);
    registerItemParams(pictionary);
    expect(paramsTypeFor({ input: 'app:party-games/pictionary:x' })).toBe(pictionary);
    expect(paramsTypeFor({ input: 'app:party-games/charades:x' })).toBe(charades);
  });

  it.each([
    ['id', { id: 7 }],
    ['label', { label: undefined }],
    ['matches', { matches: 'charades' }],
    ['summary', { summary: null }],
    ['Editor', { Editor: {} }],
  ])('throws when %s has the wrong shape', (_field, overrides) => {
    expect(() => registerItemParams(charadesType(overrides))).toThrow(TypeError);
    expect(paramsTypeFor({ input: 'app:party-games/charades:fhe' })).toBeNull();
  });

  it('throws when the type is not an object', () => {
    expect(() => registerItemParams(null)).toThrow(TypeError);
  });
});

describe('KNOWN_ITEM_FIELDS', () => {
  it('lists params, so the item editor never shows it as a custom field', () => {
    expect(KNOWN_ITEM_FIELDS).toContain('params');
  });
});
