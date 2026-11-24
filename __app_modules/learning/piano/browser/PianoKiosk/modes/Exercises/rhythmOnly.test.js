import { describe, expect, it } from 'vitest';
import { RHYTHM_MIDI, rhythmNotes, toRhythmExpectation, toRhythmMusicXml } from './rhythmOnly.js';

describe('toRhythmExpectation', () => {
  const expectation = { version: 1, tempoMap: [{ onsetQuarter: 0, bpm: 90 }], measureMap: [], events: [
    { id: 'e1', onsetQuarter: 0, durationQuarters: 1, spanId: 'measure:0', notes: [{ id: 'n1', midi: 64, part: 'rh' }, { id: 'n2', midi: 48, part: 'lh' }] },
    { id: 'e2', onsetQuarter: 1, durationQuarters: 1, spanId: 'measure:0', notes: [{ id: 'n3', midi: 67, part: 'rh' }] },
    { id: 'e3', onsetQuarter: 2, durationQuarters: 1, spanId: 'measure:0', notes: [] },
  ] };
  it('reduces every event to one note on one pitch and keeps the timing', () => {
    const out = toRhythmExpectation(expectation);
    expect(out.events.map((event) => [event.id, event.onsetQuarter, event.notes.map((note) => note.midi)])).toEqual([['e1', 0, [RHYTHM_MIDI]], ['e2', 1, [RHYTHM_MIDI]], ['e3', 2, []]]);
    expect(out.tempoMap).toBe(expectation.tempoMap);
    expect(out.events[0].notes[0].id).toBe('n1:rhythm');
  });
  it('does not touch the original', () => {
    toRhythmExpectation(expectation);
    expect(expectation.events[0].notes).toHaveLength(2);
  });
  it('passes through what it cannot read', () => {
    expect(toRhythmExpectation(null)).toBeNull();
  });
});

describe('rhythmNotes', () => {
  it('reads any key, or several together, as one tap stamped at the first press', () => {
    const held = new Map([[72, { velocity: 80, timestamp: 1200 }], [40, { velocity: 60, timestamp: 1100 }]]);
    expect([...rhythmNotes(held)]).toEqual([[RHYTHM_MIDI, { velocity: 60, timestamp: 1100 }]]);
  });
  it('is empty when nothing is held', () => {
    expect(rhythmNotes(new Map()).size).toBe(0);
  });
});

describe('toRhythmMusicXml', () => {
  const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>1</duration><type>quarter</type><accidental>sharp</accidental><staff>1</staff></note>
      <note><chord/><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><rest/><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>half</type><staff>2</staff></note>
    </measure></part></score-partwise>`;
  const read = (text) => new DOMParser().parseFromString(text, 'application/xml');
  it('puts every note on its staff middle line with an X head, drops chord notes and accidentals, keeps rests and durations', () => {
    const doc = read(toRhythmMusicXml(xml));
    const notes = [...doc.getElementsByTagName('note')];
    expect(notes).toHaveLength(3);
    const pitched = notes.filter((n) => n.getElementsByTagName('pitch').length);
    expect(pitched.map((n) => [n.getElementsByTagName('step')[0].textContent, n.getElementsByTagName('octave')[0].textContent, n.getElementsByTagName('notehead')[0].textContent])).toEqual([['B', '4', 'x'], ['D', '3', 'x']]);
    expect(doc.getElementsByTagName('alter')).toHaveLength(0);
    expect(doc.getElementsByTagName('accidental')).toHaveLength(0);
    expect(notes.map((n) => n.getElementsByTagName('duration')[0].textContent)).toEqual(['1', '1', '2']);
    expect(notes[1].getElementsByTagName('rest')).toHaveLength(1);
  });
  it('returns what it cannot parse unchanged', () => {
    expect(toRhythmMusicXml('<not xml')).toBe('<not xml');
    expect(toRhythmMusicXml(null)).toBeNull();
  });
});
