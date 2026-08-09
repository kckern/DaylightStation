import { describe, it, expect } from 'vitest';
import { inputKind, writtenMidisAtStep } from './inputKind.js';

describe('inputKind', () => {
  const written = new Set([67, 60]);

  it('draws nothing for a pitch written here — the flash reports that, as an event', () => {
    // "You played this and it was right" is a claim about a moment. Held state
    // cannot make it: the cursor advances in the same task as the press, so held
    // state is only ever read against the NEXT note.
    expect(inputKind(67, written, false)).toBe(null);
  });

  it('draws nothing for a repeated pitch still held from the previous note', () => {
    // The trap: cursor on E, next note also E, first one still down. Reading held
    // state would paint it correct against the new note while the gate waits for
    // a press that never came — the page saying "right" and refusing to move.
    // Nothing is drawn, so holding a key makes no claim at all.
    expect(inputKind(64, new Set([64]), true)).toBe(null);
    expect(inputKind(64, new Set([64]), false)).toBe(null);
  });

  it('ghosts a pitch that is not written here, when nothing is judging', () => {
    expect(inputKind(61, written, false)).toBe('ghost');
  });

  it('draws nothing for an unwritten pitch while the gate judges — red owns it', () => {
    expect(inputKind(61, written, true)).toBe(null);
  });

  it('ghosts everything unwritten when the step writes nothing', () => {
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
