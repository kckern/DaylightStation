import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalShift, noteSignature, mergeLoopGroup, targetPath,
  classifyDrums, pickEnrichment, slugMap, ENRICHMENT_FIELDS,
} from './ingestCore.mjs';
import { GM_DRUM } from '../../shared/music/percussion.mjs';

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

describe('classifyDrums (whole-file groove gate)', () => {
  const notesOn = (pitches) => pitches.map((midi, i) => ({ midi, ticks: i * 240 }));
  const drumPitches = [GM_DRUM.kick, GM_DRUM.snare, GM_DRUM.hatClosed, GM_DRUM.hatClosed,
    GM_DRUM.kick, GM_DRUM.snare, GM_DRUM.hatOpen, GM_DRUM.ride];

  it('types a channel-9 drum file as groove', () => {
    const res = classifyDrums([{ channel: 9, notes: notesOn(drumPitches) }]);
    assert.equal(res.kind, 'groove');
  });

  it('NEVER flips a coverage-only file to groove — stays harmonic with a suggestion tag', () => {
    // A bassline hammering kick/snare/tomLo pitches on a melodic channel:
    // 100% GM_DRUM pitch coverage, zero channel-9 evidence. Pre-gate this
    // false-positive became type:groove (76 confirmed on the real packs).
    const res = classifyDrums([{ channel: 0, notes: notesOn(drumPitches) }]);
    assert.equal(res.kind, 'harmonic');
    assert.equal(res.coverageSuggestion, true);
  });

  it('skips channel-9 drums mixed with substantial pitched material as mixed', () => {
    const res = classifyDrums([
      { channel: 9, notes: notesOn(drumPitches) }, // 8 drum notes
      { channel: 0, notes: notesOn([60, 64, 67, 72, 76, 79]) }, // 6 pitched notes → 57% drums
    ]);
    assert.equal(res.kind, 'mixed');
    assert.ok(res.ratio > 0.5 && res.ratio < 0.9);
  });

  it('does not let coverage-only tracks force a mixed skip on a harmonic file', () => {
    // Pitched piece plus a bass track whose pitches fake drum coverage: no
    // channel-9 anywhere → harmonic (suggestion), never skipped.
    const res = classifyDrums([
      { channel: 1, notes: notesOn([GM_DRUM.kick, GM_DRUM.snare, GM_DRUM.tomLo, GM_DRUM.kick]) },
      { channel: 0, notes: notesOn([60, 64, 67, 72, 76, 79]) },
    ]);
    assert.equal(res.kind, 'harmonic');
    assert.equal(res.coverageSuggestion, true);
  });

  it('is harmonic with no suggestion when nothing reads as drums', () => {
    const res = classifyDrums([{ channel: 0, notes: notesOn([60, 62, 64, 65, 67, 69]) }]);
    assert.equal(res.kind, 'harmonic');
    assert.equal(res.coverageSuggestion, undefined);
  });
});

describe('enrichment carry-over (pickEnrichment / slugMap)', () => {
  it('picks exactly the enrichment-owned fields that are present', () => {
    const old = {
      slug: 'am-f-c-g', path: 'chord-progressions/niko/am-f-c-g.mid', type: 'chord-progression',
      timeline: [[0, 4, 7]], timelineRoot: 0, specificity: 'triad', rootSource: 'declared',
      title: 'Am F · C G', signature: null, bpm: 120,
    };
    const picked = pickEnrichment(old);
    assert.deepEqual(picked, {
      signature: null, title: 'Am F · C G',
      timeline: [[0, 4, 7]], timelineRoot: 0, specificity: 'triad', rootSource: 'declared',
    });
    assert.ok(!('bpm' in picked)); // ingest-owned fields never carried
    assert.ok(!('path' in picked));
  });

  it('carries needsReview flags so flagged entries stay flagged until re-enriched', () => {
    const picked = pickEnrichment({ slug: 'x', needsReview: true, needsReviewReason: 'parse-fail' });
    assert.deepEqual(picked, { needsReview: true, needsReviewReason: 'parse-fail' });
  });

  it('every ENRICHMENT_FIELD is one loop-enrich/enrich-index produces', () => {
    assert.deepEqual([...ENRICHMENT_FIELDS], [
      'signature', 'title', 'timeline', 'timelineRoot', 'specificity', 'rootSource',
      'needsReview', 'needsReviewReason',
    ]);
  });

  it('slugMap excludes ambiguous (duplicated) slugs', () => {
    const map = slugMap([
      { slug: 'a', path: 'p1' },
      { slug: 'b', path: 'p2' },
      { slug: 'b', path: 'p3' }, // collision-suffixed twin shares the slug
    ]);
    assert.equal(map.get('a').path, 'p1');
    assert.equal(map.has('b'), false);
  });
});
