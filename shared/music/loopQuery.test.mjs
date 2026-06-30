import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryLoops, facets } from './loopQuery.mjs';

const LIB = [
  { slug: 'a', type: 'chord-progression', mood: 'Catchy', sources: ['niko-chord'], chords: ['C', 'F', 'G'], artist: null, descriptor: null },
  { slug: 'b', type: 'melody', mood: 'Dark', sources: ['niko-master'], chords: null, artist: null, descriptor: 'Brooding line' },
  { slug: 'c', type: 'melody', mood: 'Catchy', sources: ['melody-starters'], chords: null, artist: null, descriptor: null },
  { slug: 'd', type: 'chord-progression', mood: null, sources: ['famous'], chords: ['Am', 'F'], artist: 'Drake', descriptor: null },
];

describe('queryLoops', () => {
  it('filters by role', () => {
    assert.deepEqual(queryLoops(LIB, { role: 'melody' }).map((l) => l.slug), ['b', 'c']);
  });
  it('filters by mood (case-insensitive)', () => {
    assert.deepEqual(queryLoops(LIB, { mood: 'catchy' }).map((l) => l.slug), ['a', 'c']);
  });
  it('filters by source', () => {
    assert.deepEqual(queryLoops(LIB, { source: 'famous' }).map((l) => l.slug), ['d']);
  });
  it('text-searches slug, chords, artist, descriptor', () => {
    assert.deepEqual(queryLoops(LIB, { text: 'drake' }).map((l) => l.slug), ['d']);
    assert.deepEqual(queryLoops(LIB, { text: 'brooding' }).map((l) => l.slug), ['b']);
    assert.deepEqual(queryLoops(LIB, { text: 'Am' }).map((l) => l.slug), ['d']);
  });
  it('combines filters (AND)', () => {
    assert.deepEqual(queryLoops(LIB, { role: 'melody', mood: 'Catchy' }).map((l) => l.slug), ['c']);
  });
  it('returns all with no filters', () => {
    assert.equal(queryLoops(LIB, {}).length, 4);
  });
});

describe('facets', () => {
  it('counts roles, moods and sources for filter chips', () => {
    const f = facets(LIB);
    assert.deepEqual(f.roles, { chords: 2, melody: 2 });
    assert.deepEqual(f.moods, { Catchy: 2, Dark: 1 });
    assert.equal(f.sources['niko-chord'], 1);
    assert.equal(f.sources.famous, 1);
  });
});
