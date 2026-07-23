import { describe, it, expect } from 'vitest';
import { KINDS, groupByKind } from './kinds.js';

const shelf = {
  materials: [
    { id: 'v1', medium: 'video', title: 'Big History' },
    { id: 'a1', medium: 'audio', title: 'I Survived' },
  ],
  banks: [{ id: 'b1', title: 'US States' }],
  courses: [{ id: 'glossika-korean', label: 'Glossika Korean' }],
};
const programs = [{ id: 'typing', label: 'Typing', section: 'typing' }];

describe('KINDS', () => {
  it('is the four kinds in section order after Continue', () => {
    expect(KINDS.map((k) => k.id)).toEqual(['video', 'audio', 'apps', 'decks']);
  });
  it('each kind carries a Tile component', () => {
    KINDS.forEach((k) => expect(typeof k.Tile).toBe('function'));
  });
});

describe('groupByKind', () => {
  const g = groupByKind({ shelf, programs });
  it('splits media by medium', () => {
    expect(g.video.map((m) => m.id)).toEqual(['v1']);
    expect(g.audio.map((m) => m.id)).toEqual(['a1']);
  });
  it('apps = subject programs then language courses', () => {
    expect(g.apps.map((a) => a.id)).toEqual(['typing', 'glossika-korean']);
  });
  it('decks = banks', () => {
    expect(g.decks.map((d) => d.id)).toEqual(['b1']);
  });
  it('missing shelf pieces yield empty arrays, not crashes', () => {
    const e = groupByKind({ shelf: { materials: [], banks: [], courses: [] }, programs: [] });
    expect(e).toEqual({ video: [], audio: [], apps: [], decks: [] });
  });
});
