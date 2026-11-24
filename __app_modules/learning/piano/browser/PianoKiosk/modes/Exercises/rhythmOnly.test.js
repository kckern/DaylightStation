import { describe, expect, it } from 'vitest';
import { RHYTHM_MIDI, rhythmNotes, rhythmScoreVerdicts, toRhythmExpectation, toRhythmMusicXml } from './rhythmOnly.js';
import { assessmentVerdicts } from '../../../performance/timedVerdicts.js';

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
  it('keeps each kept event\'s place in the real passage', () => {
    expect(toRhythmExpectation(expectation).events.map((event) => event.sourceIndex)).toEqual([0, 1, 2]);
  });
  it('drops grace notes, and an event of grace notes only', () => {
    const graced = { ...expectation, events: [
      { id: 'g', onsetQuarter: 0, notes: [{ id: 'gn', midi: 62, grace: true }] },
      { id: 'e1', onsetQuarter: 0, notes: [{ id: 'n1', midi: 64, grace: true }, { id: 'n2', midi: 48 }] },
    ] };
    const out = toRhythmExpectation(graced);
    expect(out.events.map((event) => [event.id, event.notes[0].id, event.sourceIndex])).toEqual([['e1', 'n2:rhythm', 1]]);
  });
  it('merges a trill or a fast run into one tap at the take tempo', () => {
    // 90 bpm: a 32nd is 83 ms apart, too close to tap; a quarter (667 ms) is not.
    const trill = { ...expectation, events: [0, 0.125, 0.25, 0.375, 1].map((onsetQuarter, i) => ({ id: `t${i}`, onsetQuarter, notes: [{ id: `n${i}`, midi: 60 + (i % 2) }] })) };
    const out = toRhythmExpectation(trill);
    // 0 and 0.25 (167 ms) are both kept; 0.125 and 0.375 are inside a tap of the one before.
    expect(out.events.map((event) => event.id)).toEqual(['t0', 't2', 't4']);
    // The same notes at a quarter of the speed are all tappable.
    expect(toRhythmExpectation({ ...trill, tempoMap: [{ onsetQuarter: 0, bpm: 22.5 }] }).events).toHaveLength(5);
  });
});

describe('rhythmScoreVerdicts', () => {
  // The passage as the rhythm score engraves it: X heads on B4 (71) and D3 (50), both staves at each onset.
  const drawn = { version: 1, tempoMap: [{ onsetQuarter: 0, bpm: 90 }], measureMap: [], events: [
    { id: 'e0', onsetQuarter: 0, notes: [{ id: 'a', midi: 71 }, { id: 'b', midi: 50 }] },
    { id: 'e1', onsetQuarter: 1, notes: [{ id: 'c', midi: 71 }] },
    { id: 'e2', onsetQuarter: 2, notes: [{ id: 'd', midi: 71 }, { id: 'e', midi: 50 }] },
    { id: 'e3', onsetQuarter: 3, notes: [{ id: 'f', midi: 50 }] },
  ] };
  const verdictsOf = (expectation, { hits = {}, misses = [], lapsed = [] }) => assessmentVerdicts({ expectation, hits, misses, lapsed, wrong: [] });

  it('paints every engraved head of a tap\'s event with the tap\'s verdict, at the pitch the head is drawn at', () => {
    const rhythm = toRhythmExpectation(drawn);
    const painted = rhythmScoreVerdicts(verdictsOf(rhythm, {
      hits: { 'a:rhythm': { driftMs: 5 }, 'c:rhythm': { offbeat: 'late', driftMs: 140 } }, misses: ['d:rhythm'],
    }), rhythm.events);
    expect([...painted.keys()]).toEqual([0, 1, 2]);
    expect([...painted.get(0)].map(([midi, verdict]) => [midi, verdict.state])).toEqual([[71, 'hit'], [50, 'hit']]);
    expect([...painted.get(1)].map(([midi, verdict]) => [midi, verdict.state])).toEqual([[71, 'late']]);
    expect([...painted.get(2)].map(([midi, verdict]) => [midi, verdict.state])).toEqual([[71, 'miss'], [50, 'miss']]);
    // Nothing on the rhythm pitch itself: no head is drawn there.
    for (const heads of painted.values()) expect(heads.has(RHYTHM_MIDI)).toBe(false);
  });

  it('maps a dropped or merged event back to its own source index', () => {
    // At 960 bpm a quarter is 62.5 ms: e1 merges into e0's tap, e3 into e2's.
    const fast = { ...drawn, tempoMap: [{ onsetQuarter: 0, bpm: 960 }] };
    const rhythm = toRhythmExpectation(fast);
    expect(rhythm.events.map((event) => event.sourceIndex)).toEqual([0, 2]);
    const painted = rhythmScoreVerdicts(verdictsOf(rhythm, { hits: { 'a:rhythm': {}, 'd:rhythm': { offbeat: 'early' } } }), rhythm.events);
    expect([...painted].map(([index, heads]) => [index, [...heads].map(([midi, verdict]) => `${midi}:${verdict.state}`)])).toEqual([
      [0, ['71:hit', '50:hit']], [1, ['71:hit']], [2, ['71:early', '50:early']], [3, ['50:early']],
    ]);
  });

  it('passes through what it cannot read', () => {
    expect(rhythmScoreVerdicts(null, [])).toBeNull();
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
  it('hides grace notes', () => {
    const graced = xml.replace('<note><rest/>', '<note><grace slash="yes"/><pitch><step>G</step><octave>5</octave></pitch><type>eighth</type><staff>1</staff></note><note><rest/>');
    const doc = read(toRhythmMusicXml(graced));
    expect(doc.getElementsByTagName('grace')).toHaveLength(0);
    expect(doc.getElementsByTagName('note')).toHaveLength(3);
  });
  it('returns what it cannot parse unchanged', () => {
    expect(toRhythmMusicXml('<not xml')).toBe('<not xml');
    expect(toRhythmMusicXml(null)).toBeNull();
  });
});
