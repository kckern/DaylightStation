import { describe, it, expect } from 'vitest';
import { issueWorksheet } from './questionBankV2.mjs';

/** A bank shaped like the real compact-v2 scripture ones: answer + a decoy pool. */
const bank = (count = 3) => ({
  id: 'test/spread',
  items: Array.from({ length: count }, (_, n) => ({
    id: `q${n + 1}`,
    type: 'multiple_choice',
    prompt: `Question ${n + 1}?`,
    answer: `CORRECT-${n + 1}`,
    decoys: [`d${n}a`, `d${n}b`, `d${n}c`, `d${n}d`, `d${n}e`, `d${n}f`],
  })),
});

const issue = (seed, profile = 'lower-3', items = 3) => issueWorksheet({
  bank: bank(items), learnerId: 'test-learner', enrollmentId: 'e', lessonId: 'l', profile, seed,
});

const letters = (sheet) => sheet.items.map((q) => q.options.find((o) => o.correct)?.letter);

const longestRun = (letters) => {
  let best = 0; let run = 0; let previous = null;
  for (const letter of letters) { run = letter === previous ? run + 1 : 1; if (run > best) best = run; previous = letter; }
  return best;
};
const mostOfOne = (letters) => Math.max(0, ...Object.values(
  letters.reduce((acc, l) => ({ ...acc, [l]: (acc[l] ?? 0) + 1 }), {}),
));

describe('a worksheet never looks contrived', () => {
  it('never prints three of the same letter in a row', () => {
    // A learner got A/A/A on 2026-09-11 from a perfectly fair shuffle: three draws
    // over three or four options come up all-one-letter about once in
    // seventeen sheets. It reads as a broken randomizer, and a column filled
    // without reading scores 100%.
    for (let i = 0; i < 600; i += 1) {
      expect(longestRun(letters(issue(`ses_${i}:0`)))).toBeLessThan(3);
    }
  });

  it('never lets one letter hold more than half the sheet', () => {
    for (let i = 0; i < 600; i += 1) {
      // Three questions: cap 2, so all-three-same is refused and two is fine.
      expect(mostOfOne(letters(issue(`ses_${i}:0`)))).toBeLessThanOrEqual(2);
    }
  });

  it('holds on the longer profiles too, where the cap is looser', () => {
    const wide = { id: 'test/spread', items: [...bank(16).items] };
    for (let i = 0; i < 300; i += 1) {
      const sheet = issueWorksheet({ bank: wide, learnerId: 'test-learner', enrollmentId: 'e', lessonId: 'l', profile: 'lower', seed: `w_${i}:0` });
      const L = sheet.items.filter((q) => q.type === 'multiple_choice').map((q) => q.options.find((o) => o.correct)?.letter);
      expect(longestRun(L)).toBeLessThan(3);
      expect(mostOfOne(L)).toBeLessThanOrEqual(Math.max(2, Math.ceil(L.length / 2)));
    }
  });

  it('leaves the spread natural — it refuses patterns, it does not force uniformity', () => {
    // The fix must not trade one artefact for another. A rule that forced an
    // even split would be its own pattern: a child could count off the letters
    // already used and narrow the last answers.
    const tally = {};
    for (let i = 0; i < 600; i += 1) for (const L of letters(issue(`ses_${i}:0`))) tally[L] = (tally[L] ?? 0) + 1;
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    // A/B/C are reachable on every item (3 or 4 options); D only on four-option
    // ones, so it legitimately carries about half the share of the others.
    for (const letter of ['A', 'B', 'C']) {
      expect(tally[letter] / total).toBeGreaterThan(0.2);
      expect(tally[letter] / total).toBeLessThan(0.38);
    }
    expect(tally.D / total).toBeGreaterThan(0.05);
  });

  it('is reproducible from the seed, so a minted artifact still replays', () => {
    // The re-roll draws from the same seeded stream. If it did not, an issued
    // worksheet could not be regenerated from its seed and every reprint would
    // be a different sheet.
    const a = issue('ses_fixed:0');
    const b = issue('ses_fixed:0');
    expect(JSON.stringify(a.items)).toBe(JSON.stringify(b.items));
  });

  it('keeps the DECOYS it sampled — it re-orders, it does not re-pick', () => {
    // Re-picking distractors would change what the sheet asks.
    for (const q of issue('ses_7:0').items) {
      const labels = q.options.map((o) => o.label);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels.filter((l) => l.startsWith('CORRECT-')).length).toBe(1);
    }
  });

  it('letters stay contiguous from A after a re-roll', () => {
    // The re-roll re-letters from scratch; a stale letter would put two Bs on
    // one question and break the OMR card's column mapping.
    for (let i = 0; i < 50; i += 1) {
      for (const q of issue(`ses_${i}:0`).items) {
        expect(q.options.map((o) => o.letter)).toEqual(['A', 'B', 'C', 'D', 'E'].slice(0, q.options.length));
      }
    }
  });
});
