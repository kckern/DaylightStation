import { describe, it, expect } from 'vitest';
import { makeEmptyScore } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/score.js';
import { serializeMusicXml } from './serializeMusicXml.js';
import { parseMusicXml } from './parseMusicXml.js';
import { makeNote, makeRest } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/note.js';

function scoreWith(notes) {
  const s = makeEmptyScore();
  s.parts[0].measures[0].notes = notes;
  return s;
}

describe('serializeMusicXml — scaffold', () => {
  const xml = serializeMusicXml(makeEmptyScore());
  it('emits a score-partwise document with a part and one measure', () => {
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('<part id="P1">');
    expect(xml).toContain('<measure number="1">');
  });
  it('is parseable by DOMParser (no parsererror)', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });
  it('round-trips the header through parseMusicXml (4/4, C, tempo 100)', () => {
    const back = parseMusicXml(xml);
    expect(back.timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(back.key.fifths).toBe(0);
    expect(back.tempo).toBe(100);
  });
});

describe('serializeMusicXml — pitched note', () => {
  it('round-trips a single C4 quarter (midi 60, quarter, staff 1)', () => {
    const xml = serializeMusicXml(scoreWith([makeNote({ step: 'C', octave: 4 }, { type: 'quarter' })]));
    const n = parseMusicXml(xml).parts[0].measures[0].notes[0];
    expect(n.midi).toBe(60);
    expect(n.type).toBe('quarter');
    expect(n.rest).toBe(false);
  });
  it('emits alter for F#4', () => {
    const xml = serializeMusicXml(scoreWith([makeNote({ step: 'F', octave: 4, alter: 1 }, { type: 'eighth' })]));
    expect(xml).toContain('<alter>1</alter>');
    expect(parseMusicXml(xml).parts[0].measures[0].notes[0].midi).toBe(66);
  });
});

describe('serializeMusicXml — rests', () => {
  it('round-trips a half rest', () => {
    const xml = serializeMusicXml(scoreWith([makeRest({ type: 'half' })]));
    const n = parseMusicXml(xml).parts[0].measures[0].notes[0];
    expect(n.rest).toBe(true);
    expect(n.type).toBe('half');
  });
});

describe('serializeMusicXml — ties', () => {
  it('emits tie + tied for a tie-start note', () => {
    const a = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', tie: 'start' });
    const xml = serializeMusicXml(scoreWith([a]));
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tied type="start"/>');
    // round-trip: parser reads the tie back
    expect(parseMusicXml(xml).parts[0].measures[0].notes[0].tie).toBe('start');
  });
  it('emits stop then start for a tie:both note', () => {
    const b = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', tie: 'both' });
    const xml = serializeMusicXml(scoreWith([b]));
    expect(xml).toContain('<tie type="stop"/><tie type="start"/>');
    expect(parseMusicXml(xml).parts[0].measures[0].notes[0].tie).toBe('both');
  });
});

describe('serializeMusicXml — triplets', () => {
  it('emits time-modification 3-in-2 for an 8th triplet', () => {
    const xml = serializeMusicXml(scoreWith([makeNote({ step: 'C', octave: 4 }, { type: 'eighth', triplet: true })]));
    expect(xml).toContain('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
    const n = parseMusicXml(xml).parts[0].measures[0].notes[0];
    expect(n.triplet).toBe(true);
    expect(n.tuplet).toEqual({ actual: 3, normal: 2 });
  });
});

describe('serializeMusicXml — expressive marks', () => {
  it('emits a dynamics direction and an articulation notation', () => {
    const n = makeNote({ step: 'C', octave: 4 }, { type: 'quarter' });
    n.dynamics = 'f'; n.articulations = ['staccato'];
    const xml = serializeMusicXml(scoreWith([n]));
    expect(xml).toContain('<dynamics><f/></dynamics>');
    expect(xml).toContain('<articulations><staccato/></articulations>');
    const back = parseMusicXml(xml).parts[0].measures[0].notes[0];
    expect(back.dynamics).toBe('f');
    expect(back.articulations).toEqual(['staccato']);
  });
});

describe('serializeMusicXml — lyrics', () => {
  it('emits a lyric syllable', () => {
    const n = makeNote({ step: 'C', octave: 4 }, { type: 'quarter' });
    n.lyric = 'la';
    const xml = serializeMusicXml(scoreWith([n]));
    expect(xml).toContain('<lyric><text>la</text></lyric>');
    expect(parseMusicXml(xml).parts[0].measures[0].notes[0].lyric).toBe('la');
  });
});

describe('serializeMusicXml — chords + staves', () => {
  it('emits <chord/> on stacked notes and <staff> when >1 staff', () => {
    const s = makeEmptyScore(); s.parts[0].staves = 2;
    const root = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', staff: 1 });
    const third = makeNote({ step: 'E', octave: 4 }, { type: 'quarter', staff: 1, chord: true });
    const bass = makeNote({ step: 'C', octave: 3 }, { type: 'quarter', staff: 2 });
    s.parts[0].measures[0].notes = [root, third, bass];
    const xml = serializeMusicXml(s);
    expect(xml).toContain('<chord/>');
    expect(xml).toContain('<staff>2</staff>');
    expect(xml).toContain('<backup>');
  });

  it('preserves onsets when a measure interleaves staves (s1,s2,s1)', () => {
    const s = makeEmptyScore(); s.parts[0].staves = 2;
    const c4 = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', staff: 1 });
    const c3 = makeNote({ step: 'C', octave: 3 }, { type: 'quarter', staff: 2 });
    const d4 = makeNote({ step: 'D', octave: 4 }, { type: 'quarter', staff: 1 });
    s.parts[0].measures[0].notes = [c4, c3, d4];
    const back = parseMusicXml(serializeMusicXml(s));
    const notes = back.parts[0].measures[0].notes.filter(n => !n.rest);
    const byMidi = (m) => notes.find(n => n.midi === m);
    // C4 at beat 0, D4 at beat 1 (staff 1 sequence), C3 at beat 0 (staff 2)
    expect(byMidi(60).onsetQuarter).toBe(0);
    expect(byMidi(62).onsetQuarter).toBe(1);
    expect(byMidi(48).onsetQuarter).toBe(0);
  });
});

describe('serializeMusicXml — full-feature note stays parseable', () => {
  it('a note with tie+triplet+dynamics+articulation+lyric is DOMParser-parseable (order valid)', () => {
    const n = makeNote({ step: 'C', octave: 4 }, { type: 'eighth', tie: 'both', triplet: true });
    n.dynamics = 'mf'; n.articulations = ['staccato', 'accent']; n.lyric = 'la';
    const xml = serializeMusicXml(scoreWith([n]));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });
});

describe('serializeMusicXml — loud guards for beyond-v1 silent-loss paths', () => {
  it('THROWS on a multi-part score rather than dropping parts (finding #4)', () => {
    const s = makeEmptyScore();
    s.parts.push({ id: 'P2', name: 'Bass', staves: 1, clefs: { 1: { sign: 'F', line: 4 } }, measures: [{ number: 1, notes: [] }] });
    expect(() => serializeMusicXml(s)).toThrow(/multi-part/);
    // valid single-part v1 input does NOT throw
    expect(() => serializeMusicXml(makeEmptyScore())).not.toThrow();
  });

  it('THROWS on a mid-piece key change rather than corrupting on save (finding #5)', () => {
    const s = makeEmptyScore();
    s.parts[0].measures.push({ number: 2, notes: [], attributes: { key: { fifths: 3 }, time: { beats: 4, beatType: 4 } } });
    expect(() => serializeMusicXml(s)).toThrow(/mid-piece key\/time/);
  });

  it('THROWS on a mid-piece time change rather than corrupting on save (finding #5)', () => {
    const s = makeEmptyScore();
    s.parts[0].measures.push({ number: 2, notes: [], attributes: { key: { fifths: 0 }, time: { beats: 3, beatType: 4 } } });
    expect(() => serializeMusicXml(s)).toThrow(/mid-piece key\/time/);
    // a later measure re-declaring the SAME key/time is fine (no real change)
    const same = makeEmptyScore();
    same.parts[0].measures.push({ number: 2, notes: [], attributes: { key: { fifths: 0 }, time: { beats: 4, beatType: 4 } } });
    expect(() => serializeMusicXml(same)).not.toThrow();
  });

  it('THROWS on a non-3:2 tuplet rather than corrupting it on save (finding #7)', () => {
    const n = makeNote({ step: 'C', octave: 4 }, { type: '16th' });
    n.tuplet = { actual: 5, normal: 4 }; // a quintuplet — not reproducible in v1
    expect(() => serializeMusicXml(scoreWith([n]))).toThrow(/only 3:2 triplets/);
    // a real 3:2 triplet continues to serialize normally
    const trip = makeNote({ step: 'C', octave: 4 }, { type: 'eighth', triplet: true });
    trip.tuplet = { actual: 3, normal: 2 };
    expect(() => serializeMusicXml(scoreWith([trip]))).not.toThrow();
  });
});

describe('serializeMusicXml — title / part-name correctness', () => {
  it('omits <work-title> for a null/empty title (never emits the literal "null")', () => {
    const s = makeEmptyScore(); s.title = null;
    const xml = serializeMusicXml(s);
    expect(xml).not.toContain('<work-title>');
    expect(xml).not.toContain('null');
    // reloaded title is not the string "null"
    expect(parseMusicXml(xml).title).not.toBe('null');
  });

  it('round-trips a non-default part name instead of hardcoding "Music"', () => {
    const s = makeEmptyScore(); s.parts[0].name = 'Piano';
    const xml = serializeMusicXml(s);
    expect(xml).toContain('<part-name>Piano</part-name>');
    expect(parseMusicXml(xml).parts[0].name).toBe('Piano');
  });

  it('emits a schema-valid tempo direction and still round-trips the tempo', () => {
    const s = makeEmptyScore(); s.tempo = 132;
    const xml = serializeMusicXml(s);
    // the <direction> now has a <direction-type> child (schema-valid)
    expect(xml).toContain('<direction-type><metronome>');
    expect(parseMusicXml(xml).tempo).toBe(132);
  });
});
