import { describe, it, expect } from 'vitest';
import { buildBrickEntry, computeTonicPc, parseCanonicalDurations } from './loopManifest.mjs';

const misc = (fields) => `<miscellaneous>${Object.entries(fields).map(([k, v]) => `<miscellaneous-field name="${k}">${v}</miscellaneous-field>`).join('')}</miscellaneous>`;
const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const cMajorTriad = `<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration></note></measure>`;
// A second whole-note triad measure (no repeated <attributes>) → 2 bars = 8 slots.
const measure2Triad = '<measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration></note></measure>';
const twoBarTriad = cMajorTriad + measure2Triad;

describe('buildBrickEntry', () => {
  it('splits comma metadata into arrays and coerces bpm', () => {
    const xml = `<x>${misc({ type: 'melody', title: 'Lofi', genre: 'lofi,jazz', emotion: '', tags: 'lofi,jazz', quality: 'best', artist: '', bpm: '160', 'source-slug': 'lofi-1', 'derived-signature': '' })}${cMajorTriad}</x>`;
    const e = buildBrickEntry('melodies/lofi-1.musicxml', xml);
    expect(e.path).toBe('melodies/lofi-1.musicxml');
    expect(e.slug).toBe('lofi-1');
    expect(e.type).toBe('melody');
    expect(e.genre).toEqual(['lofi', 'jazz']);
    expect(e.emotion).toEqual([]);
    expect(e.quality).toBe('best');
    expect(e.bpm).toBe(160);
  });

  it('computeTonicPc recovers the tonic from the ledger roots + roman', () => {
    expect(computeTonicPc('F-A-C', ['I'])).toBe(5);            // I rooted on F → tonic F
    expect(computeTonicPc('A-F-C-G', ['vi', 'IV', 'I', 'V'])).toBe(0); // vi=A → tonic C
    expect(computeTonicPc('G-C-D', ['I', 'IV', 'V'])).toBe(7); // tonic G
    expect(computeTonicPc('D-A', ['bVII', 'IV'])).toBe(4);     // bVII rooted on D → tonic E
    expect(computeTonicPc(null, ['I'])).toBe(null);            // no ledger → null (caller defaults 0)
  });

  it('defaults tonicPc to 0 (C) when no ledger row is supplied', () => {
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'x', 'derived-signature': 'I' })}${cMajorTriad}</x>`;
    expect(buildBrickEntry('chords/x.musicxml', xml).tonicPc).toBe(0);
  });

  it('a brick in F (ledger tonic F) bakes a tonic-relative (F=0) timeline and tonicPc 5', () => {
    // C-F-A sounding = F major; ledger says roman I rooted on F → tonic F.
    const fMajor = `<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>16</duration></note></measure>`;
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'f1', 'derived-signature': 'I' })}${fMajor}</x>`;
    const e = buildBrickEntry('chords/f1.musicxml', xml, { harmonyKey: 'F-A-C', roman: ['I'] });
    expect(e.tonicPc).toBe(5);
    expect(e.timelineRoot).toBe(5);
    expect(e.timeline[0]).toEqual([0, 4, 7]); // F-major, root-relative to its tonic F → I chord
  });

  it('bakes a root-0 harmonic timeline for harmonic types', () => {
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'triad', 'derived-signature': 'I' })}${cMajorTriad}</x>`;
    const e = buildBrickEntry('chords/triad.musicxml', xml);
    expect(e.timelineRoot).toBe(0);
    expect(Array.isArray(e.timeline)).toBe(true);
    expect(e.timeline[0]).toEqual([0, 4, 7]); // C major triad, root-relative to C
    expect(e.roman).toEqual(['I']);
    expect(typeof e.specificity).toBe('string');
    expect(e.needsReview).toBeUndefined();
  });

  it('skips timeline for grooves', () => {
    const xml = `<x>${misc({ type: 'groove', 'source-slug': 'four-on-floor', 'canonical-name': 'four-on-floor' })}</x>`;
    const e = buildBrickEntry('percussion/four-on-floor.musicxml', xml);
    expect(e.type).toBe('groove');
    expect(e.timeline).toBeUndefined();
    expect(e.needsReview).toBeUndefined();
    expect(e.feel).toBe('four-on-floor');
  });

  it('flags a harmonic brick with no notes as needsReview', () => {
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'empty' })}<part id="P1"></part></x>`;
    const e = buildBrickEntry('chords/empty.musicxml', xml);
    expect(e.needsReview).toBe(true);
    expect(e.needsReviewReason).toBe('parse-fail');
    expect(e.timeline).toBeUndefined();
  });

  it('attaches romanDurations from the canonical-name braille when it aligns with roman + slot count', () => {
    // 2 bars = 8 slots; canonical I⠿-V⠃ → dots 6 + 2 = 8 (uneven: a longer I, shorter V).
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'iv', 'derived-signature': 'I-V', 'canonical-name': 'I⠿-V⠃' })}${twoBarTriad}</x>`;
    const e = buildBrickEntry('chords/iv.musicxml', xml);
    expect(e.timeline.length).toBe(8);
    expect(e.roman).toEqual(['I', 'V']);
    expect(e.romanDurations).toEqual([6, 2]);
  });

  it('omits romanDurations when the braille sum ≠ slot count (mismatch → even-distribution fallback)', () => {
    // I⠇-V⠇ → 3 + 3 = 6 ≠ 8 slots.
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'm', 'derived-signature': 'I-V', 'canonical-name': 'I⠇-V⠇' })}${twoBarTriad}</x>`;
    expect(buildBrickEntry('chords/m.musicxml', xml).romanDurations).toBeUndefined();
  });

  it('omits romanDurations when the token count ≠ roman count, or the canonical-name has no braille', () => {
    const noBraille = `<x>${misc({ type: 'chord-progression', 'source-slug': 'n', 'derived-signature': 'I-V', 'canonical-name': 'I-V' })}${twoBarTriad}</x>`;
    expect(buildBrickEntry('chords/n.musicxml', noBraille).romanDurations).toBeUndefined();
    // three braille tokens but roman is I-V (2) → misaligned, omitted.
    const misaligned = `<x>${misc({ type: 'chord-progression', 'source-slug': 'x', 'derived-signature': 'I-V', 'canonical-name': 'I⠇-IV⠃-V⠇' })}${twoBarTriad}</x>`;
    expect(buildBrickEntry('chords/x.musicxml', misaligned).romanDurations).toBeUndefined();
  });
});

describe('parseCanonicalDurations', () => {
  it('decodes each chord token to its braille dot-count', () => {
    expect(parseCanonicalDurations('VI⣿-II⠇-IIIsus4⠟-VI⣿-IV⠇-III⠟')).toEqual([8, 3, 5, 8, 3, 5]);
    expect(parseCanonicalDurations('I⠁-V⠃-vi⠇-IV⠏')).toEqual([1, 2, 3, 4]);
  });

  it('returns null when any token lacks a braille suffix, or the input is empty', () => {
    expect(parseCanonicalDurations('I-V-vi-IV')).toBeNull();
    expect(parseCanonicalDurations('I⠏-V')).toBeNull();
    expect(parseCanonicalDurations('')).toBeNull();
    expect(parseCanonicalDurations(null)).toBeNull();
  });
});
