import { describe, it, expect } from 'vitest';
import { buildBrickEntry } from './loopManifest.mjs';

const misc = (fields) => `<miscellaneous>${Object.entries(fields).map(([k, v]) => `<miscellaneous-field name="${k}">${v}</miscellaneous-field>`).join('')}</miscellaneous>`;
const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const cMajorTriad = `<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration></note></measure>`;

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
});
