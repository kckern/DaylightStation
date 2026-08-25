import { describe, it, expect } from 'vitest';
import { marksFromHex } from './omr.mjs';
import { decodeQuizSheet } from '#apps/quizzes/quizScanRecorder.mjs';

// This is a DRIFT GUARD, not a unit test of arithmetic. `marksFromHex` is a
// second implementation of packColumn() in
// _extensions/omr-relay/firmware/src/main.cpp — the firmware normally does this
// conversion on the board, and the CLI only redoes it when replaying a frame
// the relay failed to deliver. If the two ever disagree, a recovered scan
// grades against the wrong bubbles and looks completely plausible doing it.
//
// The fixture is a REAL frame, pulled from a real relay's /recent ring on
// 2026-08-25 and graded end to end. Do not regenerate it from this code.
describe('marksFromHex', () => {
  // Recovered from the 2026-08-25 half-open-socket incident: card 4071314,
  // fed at 16:12:42. Truncated to 16 of 32 columns by the ring's old
  // RECENT_HEX_CHARS = 64, which is exactly why this path exists.
  const REAL_FRAME = '6030203824202034202120246030282222282224282828303028283822222030';

  it('unpacks two bytes per column, low byte first, six data bits each', () => {
    const marks = marksFromHex(REAL_FRAME);
    expect(marks).toHaveLength(16);
    // Verified independently against the raw hex when the incident was
    // diagnosed — bit 6 (0x40) IS a data bit; a 5-bit mask decodes wrong.
    expect(marks).toEqual([
      1056, 1536, 4, 1280, 64, 256, 1056, 136,
      514, 258, 520, 1032, 528, 1544, 130, 1024,
    ]);
  });

  it('decodes to the test id and answers that were actually graded', () => {
    const { testId, answers } = decodeQuizSheet(marksFromHex(REAL_FRAME));
    expect(testId).toBe('4071314');
    // The live allocation was rows 31-33; these three are what produced a 3/3.
    expect(answers[31]).toBe('A');
    expect(answers[32]).toBe('B');
    expect(answers[33]).toBe('D');
    // A double-marked question keeps every letter rather than guessing.
    expect(answers[7]).toEqual(['A', 'B']);
  });

  it('tolerates the ellipsis /recent appends to a truncated preview', () => {
    expect(marksFromHex(`${REAL_FRAME}...`)).toEqual(marksFromHex(REAL_FRAME));
  });

  it('refuses a frame that is not a whole number of columns', () => {
    // A card record is always an even number of bytes. Half a column is a
    // corrupt capture, and silently dropping the odd byte would shift every
    // column after it.
    expect(() => marksFromHex('60302038242')).toThrow(/whole number of 2-byte columns/);
  });
});
