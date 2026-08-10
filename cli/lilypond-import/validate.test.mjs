import { describe, it, expect } from 'vitest';
import { validateScore } from './validate.mjs';

const grandStaff = `<?xml version="1.0"?>
<score-partwise version="3.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><staves>2</staves></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><notations><technical>
        <fingering>1</fingering></technical></notations></note>
      <note><pitch><step>E</step><octave>4</octave></pitch></note>
    </measure>
  </part>
</score-partwise>`;

// The exact shape python-ly emits when it silently fails: valid document,
// declared part, zero music.
const emptyPart = `<?xml version="1.0"?>
<score-partwise version="3.0">
  <part-list><score-part id="P1"><part-name></part-name></score-part></part-list>
  <part id="P1"></part>
</score-partwise>`;

describe('validateScore', () => {
  it('accepts a one-part, two-staff score with notes', () => {
    const r = validateScore(grandStaff);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.stats).toMatchObject({ parts: 1, staves: 2, notes: 2, measures: 1, fingerings: 1 });
  });

  it('rejects the silent-failure shape: well-formed but no notes', () => {
    const r = validateScore(emptyPart);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no notes/);
  });

  it('rejects empty output', () => {
    expect(validateScore('').ok).toBe(false);
    expect(validateScore('').reasons).toContain('empty output');
  });

  it('rejects a score that is not two staves, because hands mode needs staff 0/1', () => {
    const oneStaff = grandStaff.replace('<staves>2</staves>', '<staves>1</staves>');
    const r = validateScore(oneStaff);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/2-staff grand staff, found 1/);
  });

  it('rejects multi-part output (an unsplit multi-movement file)', () => {
    const twoParts = grandStaff.replace('</part>', '</part><part id="P2"><measure number="1"><note/></measure></part>');
    const r = validateScore(twoParts);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/exactly 1 part, found 2/);
  });

  it('does not mistake <part-list>/<part-name> for parts', () => {
    expect(validateScore(grandStaff).stats.parts).toBe(1);
  });

  it('can be relaxed for non-piano shapes', () => {
    const oneStaff = grandStaff.replace('<staves>2</staves>', '<staves>1</staves>');
    expect(validateScore(oneStaff, { requireGrandStaff: false }).ok).toBe(true);
  });
});
