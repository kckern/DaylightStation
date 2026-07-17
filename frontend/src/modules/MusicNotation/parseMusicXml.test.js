import { describe, it, expect } from 'vitest';
import maryXml from './__fixtures__/maryHadALittleLamb.musicxml?raw';
import { parseMusicXml, pitchToMidi } from './parseMusicXml.js';

describe('pitchToMidi', () => {
  it('maps pitches to MIDI (C4=60, E4=64, C3=48)', () => {
    expect(pitchToMidi({ step: 'C', octave: 4 })).toBe(60);
    expect(pitchToMidi({ step: 'E', octave: 4 })).toBe(64);
    expect(pitchToMidi({ step: 'C', octave: 3 })).toBe(48);
    expect(pitchToMidi({ step: 'F', octave: 4, alter: 1 })).toBe(66); // F#4
  });
});

describe('parseMusicXml — Mary Had a Little Lamb', () => {
  const score = parseMusicXml(maryXml);
  const part = score.parts[0];

  it('reads the grand-staff header (2 staves, G+F clefs, C major, 4/4, tempo 80)', () => {
    expect(score.parts).toHaveLength(1);
    expect(part.staves).toBe(2);
    expect(part.clefs[1].sign).toBe('G');
    expect(part.clefs[2].sign).toBe('F');
    expect(score.key.fifths).toBe(0);
    expect(score.timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(score.tempo).toBe(80);
  });

  it('has 8 measures', () => {
    expect(part.measures).toHaveLength(8);
  });

  it('parses the first measure treble melody as E4 D4 C4 D4 (quarters)', () => {
    const treble = part.measures[0].notes.filter((n) => n.staff === 1 && !n.rest);
    expect(treble.slice(0, 4).map((n) => n.midi)).toEqual([64, 62, 60, 62]);
    expect(treble.slice(0, 4).every((n) => n.type === 'quarter')).toBe(true);
  });

  it('places the bass entry on staff 2 (a low C), after a backup', () => {
    const bass = part.measures[0].notes.filter((n) => n.staff === 2 && !n.rest);
    expect(bass.length).toBeGreaterThan(0);
    expect(bass[0].midi).toBeLessThan(60); // bass register
  });

  it('gives melody notes monotonically increasing onsets', () => {
    const melody = part.notes.filter((n) => n.staff === 1 && !n.rest && !n.chord);
    for (let i = 1; i < melody.length; i++) {
      expect(melody[i].onsetQuarter).toBeGreaterThanOrEqual(melody[i - 1].onsetQuarter);
    }
    // 8 bars of 4/4 → last onset is in the 7th–8th quarter-bar range.
    expect(melody[melody.length - 1].onsetQuarter).toBeGreaterThan(20);
  });

  it('does not throw on malformed input', () => {
    expect(() => parseMusicXml('<not-musicxml/>')).not.toThrow();
  });
});

describe('tempo extraction', () => {
  const xmlWithTempoChange = `<?xml version="1.0"?>
<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
  <measure number="1">
    <attributes><divisions>1</divisions></attributes>
    <sound tempo="72"/>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
  <measure number="2">
    <sound tempo="120"/>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
</part></score-partwise>`;

  it('keeps the FIRST tempo marking (opening tempo), not the last', () => {
    expect(parseMusicXml(xmlWithTempoChange).tempo).toBe(72);
  });
});

describe('parseMusicXml — per-measure attributes', () => {
  it('captures a mid-piece time change on the measure where it occurs', () => {
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>24</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>96</duration><type>whole</type></note></measure>
      <measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>72</duration><type>half</type><dot/></note></measure>
    </part></score-partwise>`;
    const s = parseMusicXml(xml);
    expect(s.parts[0].measures[1].attributes.time).toEqual({ beats: 3, beatType: 4 });
  });
});
