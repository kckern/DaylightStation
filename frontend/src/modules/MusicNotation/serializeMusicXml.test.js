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
  });
  it('emits stop then start for a tie:both note', () => {
    const b = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', tie: 'both' });
    const xml = serializeMusicXml(scoreWith([b]));
    expect(xml).toContain('<tie type="stop"/><tie type="start"/>');
  });
});

describe('serializeMusicXml — triplets', () => {
  it('emits time-modification 3-in-2 for an 8th triplet', () => {
    const xml = serializeMusicXml(scoreWith([makeNote({ step: 'C', octave: 4 }, { type: 'eighth', triplet: true })]));
    expect(xml).toContain('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  });
});
