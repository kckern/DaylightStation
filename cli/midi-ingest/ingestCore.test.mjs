import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalShift, noteSignature, mergeLoopGroup, targetPath } from './ingestCore.mjs';

describe('canonicalShift', () => {
  it('is the shift that moves a major tonic onto C', () => {
    assert.equal(canonicalShift(0), 0); // C already canonical
    assert.equal(canonicalShift(7), 5); // G -> C up a fourth
    assert.equal(canonicalShift(6), -6); // Gb -> C (tritone, folds down)
  });
});

describe('noteSignature', () => {
  it('collapses transpositions of the same idea to one signature', () => {
    // C-E at ticks 0,240 in C major (shift 0)
    const inC = [{ ticks: 0, midi: 60 }, { ticks: 240, midi: 64 }];
    // same idea up a fifth, in G major (canonical shift +5)
    const inG = [{ ticks: 0, midi: 67 }, { ticks: 240, midi: 71 }];
    assert.equal(noteSignature(inC, canonicalShift(0)), noteSignature(inG, canonicalShift(7)));
  });
  it('is order-independent (sorts by tick then pitch-class)', () => {
    const a = [{ ticks: 240, midi: 64 }, { ticks: 0, midi: 60 }];
    const b = [{ ticks: 0, midi: 60 }, { ticks: 240, midi: 64 }];
    assert.equal(noteSignature(a, 0), noteSignature(b, 0));
  });
  it('distinguishes different rhythms / pitches', () => {
    const a = [{ ticks: 0, midi: 60 }];
    const b = [{ ticks: 0, midi: 61 }];
    assert.notEqual(noteSignature(a, 0), noteSignature(b, 0));
  });
});

describe('mergeLoopGroup', () => {
  it('picks the C-major member as canonical and unions the available keys + metadata', () => {
    const cMaj = { source: 'melody-starters', type: 'melody', mood: 'Catchy', degrees: [5, 6, 1], bpm: null, descriptor: null, key: { major: 0, minor: 9, raw: 'C Major - A Minor' }, slug: 'catchy-madness' };
    const gMaj = { source: 'niko-master', type: 'melody', mood: 'Catchy', degrees: null, bpm: 120, descriptor: 'Catchy Madness', key: { major: 7, minor: 4, raw: 'G Major - E Minor' }, slug: 'catchy-madness' };
    const merged = mergeLoopGroup([gMaj, cMaj]);
    assert.equal(merged.key.major, 0); // canonical = C member
    assert.deepEqual(merged.availableKeys.sort(), ['C Major - A Minor', 'G Major - E Minor']);
    assert.deepEqual(merged.sources.sort(), ['melody-starters', 'niko-master']);
    assert.deepEqual(merged.degrees, [5, 6, 1]); // first non-null wins
    assert.equal(merged.bpm, 120);
    assert.equal(merged.descriptor, 'Catchy Madness');
  });
  it('falls back to the first member when no C-major version exists', () => {
    const gMaj = { source: 'niko-master', type: 'melody', mood: null, degrees: null, bpm: null, descriptor: null, key: { major: 7, minor: 4, raw: 'G Major - E Minor' }, slug: 'x' };
    const merged = mergeLoopGroup([gMaj]);
    assert.equal(merged.key.major, 7);
    assert.deepEqual(merged.availableKeys, ['G Major - E Minor']);
  });
});

describe('targetPath', () => {
  it('routes by role first, then source/mood, kebab slug', () => {
    assert.equal(
      targetPath({ type: 'chord-progression', source: 'niko-chord', mood: null, slug: 'dm-c-f-gm' }),
      'chord-progressions/niko/dm-c-f-gm.mid',
    );
    assert.equal(
      targetPath({ type: 'melody', source: 'melody-starters', mood: 'Catchy', slug: 'catchy-madness' }),
      'melodies/starters/catchy/catchy-madness.mid',
    );
    assert.equal(
      targetPath({ type: 'chord-progression', source: 'famous', artist: 'Metallica', mood: null, slug: 'one-chorus' }),
      'chord-progressions/famous/metallica/one-chorus.mid',
    );
  });
  it('routes grooves under percussion/', () => {
    assert.equal(
      targetPath({ type: 'groove', source: 'niko-master', mood: null, slug: 'four-on-floor' }),
      'percussion/niko/four-on-floor.mid',
    );
  });
});
