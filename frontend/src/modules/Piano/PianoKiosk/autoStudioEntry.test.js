import { describe, it, expect } from 'vitest';
import { shouldAutoEnterStudio } from './autoStudioEntry.js';

const CFG = { minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 };
// Entries as the note store appends them ({note, velocity, startTime, endTime}).
const note = (startTime) => ({ note: 60, velocity: 90, startTime, endTime: null });

describe('shouldAutoEnterStudio', () => {
  it('fires on real playing: 8+ notes spread over 3+ seconds', () => {
    const h = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map(note);
    expect(shouldAutoEnterStudio(h, CFG)).toBe(true);
  });

  it('does not fire on a single chord (few notes, zero span)', () => {
    const h = [1000, 1000, 1000, 1001, 1001].map(note);
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('does not fire on a fast glissando (many notes, span below minimum)', () => {
    const h = Array.from({ length: 15 }, (_, i) => note(1000 + i * 100)); // 1.4s span
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('does not fire on slow noodling (span ok, too few notes in window)', () => {
    const h = [0, 2000, 4000, 6000, 8000].map(note); // 5 notes over 8s
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('old notes fall out of the rolling window', () => {
    // 7 notes clustered long ago + 1 fresh note: window only sees the fresh one.
    const h = [...[0, 100, 200, 300, 400, 500, 600].map(note), note(60_000)];
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('handles empty/short histories without firing', () => {
    expect(shouldAutoEnterStudio([], CFG)).toBe(false);
    expect(shouldAutoEnterStudio([note(0)], CFG)).toBe(false);
  });
});
