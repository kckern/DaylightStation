import { describe, it, expect } from 'vitest';
import { musicXmlToNotes, readBrickMeta } from './musicXmlToNotes.mjs';

const wrap = (measures) => `<?xml version="1.0"?><score-partwise><part id="P1">${measures}</part></score-partwise>`;
const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';

describe('musicXmlToNotes', () => {
  it('reads divisions as ppq and time signature', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.ppq).toBe(4);
    expect(out.timeSig).toEqual([4, 4]);
  });

  it('maps C4 to midi 60 and applies alter for sharps', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note><note><pitch><step>C</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes[0]).toEqual({ ticks: 0, durationTicks: 4, midi: 60 });
    expect(out.notes[1].midi).toBe(61);
  });

  it('gives chord notes the same start tick and does not advance the cursor', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes.map((n) => n.ticks)).toEqual([0, 0, 4]); // C & E stacked at 0, G at 4
  });

  it('advances the cursor past a rest without emitting a note', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><rest/><duration>4</duration></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].ticks).toBe(4);
  });

  it('merges a tie start→stop into one sustained note', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>E</step><octave>4</octave></pitch><tie type="start"/><duration>2</duration></note><note><rest/><duration>2</duration></note></measure><measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><tie type="stop"/><duration>1</duration></note></measure>`));
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].ticks).toBe(0);
    expect(out.notes[0].durationTicks).toBe(17); // 0 → measure2 (start 16) + 1
  });

  it('offsets each measure by one bar length', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes[1].ticks).toBe(16); // bar length = divisions(4) * beats(4)
  });

  it('returns an empty note list for empty/garbage input', () => {
    expect(musicXmlToNotes('').notes).toEqual([]);
    expect(musicXmlToNotes(null).notes).toEqual([]);
  });
});

describe('readBrickMeta', () => {
  it('flattens miscellaneous fields to a name→value map', () => {
    const xml = '<miscellaneous><miscellaneous-field name="type">melody</miscellaneous-field><miscellaneous-field name="tags">lofi,jazz</miscellaneous-field><miscellaneous-field name="artist"></miscellaneous-field></miscellaneous>';
    const meta = readBrickMeta(xml);
    expect(meta.type).toBe('melody');
    expect(meta.tags).toBe('lofi,jazz');
    expect(meta.artist).toBe('');
  });
});
