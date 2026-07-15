import { describe, it, expect } from 'vitest';
import { sanitizeBreadcrumbs } from './breadcrumbs.js';

// Real episode chain (root-first) from the siblings API `ancestors` field.
const collection = { id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900', type: 'collection' };
const show = { id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800', type: 'show' };
const season = { id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700', type: 'season' };

describe('sanitizeBreadcrumbs', () => {
  it('passes a clean chain through unchanged, root-first order preserved', () => {
    expect(sanitizeBreadcrumbs([collection, show, season])).toEqual([collection, show, season]);
  });

  it('drops ghost crumbs missing an id', () => {
    const ghost = { title: 'No Id', source: 'plex', localId: '1' };
    expect(sanitizeBreadcrumbs([collection, ghost, season])).toEqual([collection, season]);
  });

  it('drops ghost crumbs missing a title', () => {
    const ghost = { id: 'plex:5', source: 'plex', localId: '5' };
    expect(sanitizeBreadcrumbs([collection, ghost, season])).toEqual([collection, season]);
  });

  it('dedupes by id, keeping the first occurrence and preserving order', () => {
    const dupeShow = { ...show, title: 'Duplicate Prophets' };
    const out = sanitizeBreadcrumbs([collection, show, dupeShow, season]);
    expect(out).toEqual([collection, show, season]);
    expect(out[1].title).toBe('The Prophets'); // first occurrence wins
  });

  it('drops a synthetic library placeholder (id library:*) when a real collection exists', () => {
    const library = { id: 'library:2', title: 'TV Shows', source: 'plex', localId: '2', type: 'library' };
    expect(sanitizeBreadcrumbs([library, collection, show, season])).toEqual([collection, show, season]);
  });

  it('drops a synthetic library placeholder (title "Library") when a real container exists', () => {
    const library = { id: 'plex:2', title: 'Library', source: 'plex', localId: '2' };
    expect(sanitizeBreadcrumbs([library, show, season])).toEqual([show, season]);
  });

  it('keeps the library crumb when it is the ONLY ancestor', () => {
    const library = { id: 'library:2', title: 'TV Shows', source: 'plex', localId: '2', type: 'library' };
    expect(sanitizeBreadcrumbs([library])).toEqual([library]);
  });

  it('returns an empty array for non-array / empty input', () => {
    expect(sanitizeBreadcrumbs(null)).toEqual([]);
    expect(sanitizeBreadcrumbs(undefined)).toEqual([]);
    expect(sanitizeBreadcrumbs([])).toEqual([]);
  });

  it('drops crumbs with empty-string id or title (still ghosts)', () => {
    const emptyId = { id: '', title: 'x', source: 'plex', localId: '1' };
    const emptyTitle = { id: 'plex:6', title: '', source: 'plex', localId: '6' };
    expect(sanitizeBreadcrumbs([emptyId, show, emptyTitle])).toEqual([show]);
  });
});
