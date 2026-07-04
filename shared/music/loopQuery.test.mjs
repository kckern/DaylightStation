import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryLoops, facets } from './loopQuery.mjs';

const LIB = [
  { slug: 'a', path: 'chords/a.musicxml', type: 'chord-progression', genre: ['catchy'], emotion: ['dreamy'], tags: ['catchy', 'dreamy'], quality: 'best', title: 'A', artist: '' },
  { slug: 'b', path: 'melodies/b.musicxml', type: 'melody', genre: ['dark'], emotion: [], tags: ['dark', 'brooding'], quality: '', title: 'B', artist: '' },
  { slug: 'c', path: 'melodies/c.musicxml', type: 'melody', genre: ['catchy'], emotion: [], tags: ['catchy'], quality: '', title: 'C', artist: '' },
  { slug: 'd', path: 'chords/d.musicxml', type: 'chord-progression', genre: [], emotion: [], tags: [], quality: 'famous', title: 'D', artist: 'Drake' },
];

describe('queryLoops', () => {
  it('filters by role', () => {
    assert.deepEqual(queryLoops(LIB, { role: 'melody' }).map((l) => l.slug), ['b', 'c']);
  });
  it('filters by genre (case-insensitive)', () => {
    assert.deepEqual(queryLoops(LIB, { genre: 'CATCHY' }).map((l) => l.slug), ['a', 'c']);
  });
  it('filters by emotion (case-insensitive)', () => {
    assert.deepEqual(queryLoops(LIB, { emotion: 'Dreamy' }).map((l) => l.slug), ['a']);
  });
  it('filters by quality', () => {
    assert.deepEqual(queryLoops(LIB, { quality: 'famous' }).map((l) => l.slug), ['d']);
  });
  it('text-searches title, slug, artist, tags', () => {
    assert.deepEqual(queryLoops(LIB, { text: 'drake' }).map((l) => l.slug), ['d']);
    assert.deepEqual(queryLoops(LIB, { text: 'brooding' }).map((l) => l.slug), ['b']);
  });
  it('combines filters (AND)', () => {
    assert.deepEqual(queryLoops(LIB, { role: 'melody', genre: 'catchy' }).map((l) => l.slug), ['c']);
  });
  it('returns all with no filters', () => {
    assert.equal(queryLoops(LIB, {}).length, 4);
  });
});

describe('facets', () => {
  it('counts roles, genres, emotions and qualities for filter chips', () => {
    const f = facets(LIB);
    assert.deepEqual(f.roles, { chords: 2, melody: 2 });
    assert.deepEqual(f.genres, { catchy: 2, dark: 1 });
    assert.deepEqual(f.emotions, { dreamy: 1 });
    assert.deepEqual(f.qualities, { best: 1, famous: 1 });
  });
});
