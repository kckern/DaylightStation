import { describe, it, expect } from 'vitest';
import { isContentIdLike, shouldAutoAdd, parseSourcePrefix, isDirectSourceIdQuery } from './contentSearchLogic.js';

describe('isContentIdLike', () => {
  it.each([
    ['plex:456724', true],
    ['canvas:religious/stars.jpg', true],
    ['hymn: 147', true],            // space after colon is legal in list YAML
    ['app:webcam', true],
    ['star wars', false],           // exploratory text
    ['beet', false],
    ['plex:', false],               // no local id
    ['', false],
    [null, false],
  ])('%s → %s', (input, expected) => {
    expect(isContentIdLike(input)).toBe(expected);
  });
});

describe('shouldAutoAdd', () => {
  it('adds for id-like input (dropdown picks produce these)', () => {
    expect(shouldAutoAdd('plex:123')).toBe(true);
  });
  it('does NOT add for freeform text (junk-entries guard)', () => {
    expect(shouldAutoAdd('star wars')).toBe(false);
  });
});

describe('parseSourcePrefix', () => {
  it('parses a source:term query', () => {
    expect(parseSourcePrefix('singalong:nearer')).toEqual({ source: 'singalong', term: 'nearer' });
  });
  it('allows hyphens in the source', () => {
    expect(parseSourcePrefix('some-source:foo')).toEqual({ source: 'some-source', term: 'foo' });
  });
  it('returns null when there is no prefix', () => {
    expect(parseSourcePrefix('nearer')).toBeNull();
  });
  it('returns null for an empty term (Task 10 relies on this)', () => {
    expect(parseSourcePrefix('singalong:')).toBeNull();
  });
  it('returns null for non-string input', () => {
    expect(parseSourcePrefix(null)).toBeNull();
  });
});

describe('isDirectSourceIdQuery', () => {
  it('numeric term is a direct id (plex:455704), not a within-source search', () => {
    expect(isDirectSourceIdQuery('plex:455704')).toBe(true);
    expect(isDirectSourceIdQuery('hymn:147')).toBe(true);
  });
  it('path term is a direct id', () => {
    expect(isDirectSourceIdQuery('files:clips/mirror.mp4')).toBe(true);
    expect(isDirectSourceIdQuery('app:family-selector/mom')).toBe(true);
  });
  it('an exact id match in results makes it a direct id (slug apps)', () => {
    expect(isDirectSourceIdQuery('app:family-selector', [{ id: 'app:family-selector' }])).toBe(true);
  });
  it('a keyword term within a source is NOT a direct id (keeps the scope chip)', () => {
    expect(isDirectSourceIdQuery('plex:bluey')).toBe(false);
    expect(isDirectSourceIdQuery('plex:office', [{ id: 'plex:12345' }])).toBe(false);
  });
  it('a non-prefixed query is never a direct source id', () => {
    expect(isDirectSourceIdQuery('455704')).toBe(false);
    expect(isDirectSourceIdQuery('')).toBe(false);
    expect(isDirectSourceIdQuery(null)).toBe(false);
  });
});
