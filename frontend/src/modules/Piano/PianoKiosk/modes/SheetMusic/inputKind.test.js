import { describe, it, expect } from 'vitest';
import { inputKind, writtenMidisAtStep } from './inputKind.js';

describe('inputKind', () => {
  const written = new Set([67, 60]);

  it('is a match when the pitch is written at the cursor', () => {
    expect(inputKind(67, written, false)).toBe('match');
  });

  it('is a match regardless of which staff wrote it', () => {
    // 60 is the left hand's note; the player is holding it while practising RH.
    // The layer answers "is this on the page right now?", not "is it your job?".
    expect(inputKind(60, written, false)).toBe('match');
  });

  it('ghosts a pitch that is not written here, when nothing is grading it', () => {
    expect(inputKind(61, written, false)).toBe('ghost');
  });

  it('draws NOTHING for a non-match while the gate is grading', () => {
    // Learn's gate already inks this note red. Returning a kind would put a
    // second glyph in the same column on the same keypress.
    expect(inputKind(61, written, true)).toBe(null);
  });

  it('still matches while the gate is active', () => {
    expect(inputKind(67, written, true)).toBe('match');
  });

  it('ghosts everything when the step writes nothing', () => {
    expect(inputKind(67, new Set(), false)).toBe('ghost');
  });
});

describe('writtenMidisAtStep', () => {
  const step = { notes: [{ midi: 67, staff: 0 }, { midi: 60, staff: 1 }] };

  it('collects every pitch at the step, both staves', () => {
    expect([...writtenMidisAtStep(step)].sort((a, b) => a - b)).toEqual([60, 67]);
  });

  it('is empty for a missing step', () => {
    expect(writtenMidisAtStep(null).size).toBe(0);
    expect(writtenMidisAtStep({}).size).toBe(0);
  });
});
