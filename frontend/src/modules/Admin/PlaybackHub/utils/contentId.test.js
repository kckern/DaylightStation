import { describe, it, expect } from 'vitest';
import { splitContentId, toContentId, plexIdOnly } from './contentId.js';

describe('splitContentId', () => {
  it('splits a fully-qualified plex content ID', () => {
    expect(splitContentId('plex:670208')).toEqual({ source: 'plex', id: '670208' });
  });

  it('defaults source to plex when there is no colon', () => {
    expect(splitContentId('670208')).toEqual({ source: 'plex', id: '670208' });
  });

  it('keeps colons inside the id portion (only splits on the first colon)', () => {
    expect(splitContentId('audiobookshelf:xyz/abc:def')).toEqual({
      source: 'audiobookshelf',
      id: 'xyz/abc:def',
    });
  });

  it('returns null for empty string', () => {
    expect(splitContentId('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(splitContentId(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(splitContentId(undefined)).toBeNull();
  });

  it('returns null for non-string values', () => {
    expect(splitContentId(123)).toBeNull();
    expect(splitContentId({})).toBeNull();
    expect(splitContentId([])).toBeNull();
  });
});

describe('toContentId', () => {
  it('joins source and id with a colon', () => {
    expect(toContentId('plex', '670208')).toBe('plex:670208');
  });

  it('joins non-plex sources', () => {
    expect(toContentId('audiobookshelf', 'abc/def')).toBe('audiobookshelf:abc/def');
  });
});

describe('plexIdOnly', () => {
  it('extracts just the id portion of a content ID', () => {
    expect(plexIdOnly('plex:670208')).toBe('670208');
  });

  it('extracts the bare id when the input is unqualified', () => {
    expect(plexIdOnly('670208')).toBe('670208');
  });

  it('returns null for empty string', () => {
    expect(plexIdOnly('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(plexIdOnly(null)).toBeNull();
  });
});

describe('round-trip invariants', () => {
  it('split → toContentId reproduces a fully-qualified id', () => {
    const original = 'plex:670208';
    const parts = splitContentId(original);
    expect(toContentId(parts.source, parts.id)).toBe(original);
  });

  it('split → toContentId qualifies an unqualified id with plex', () => {
    const parts = splitContentId('670208');
    expect(toContentId(parts.source, parts.id)).toBe('plex:670208');
  });
});
