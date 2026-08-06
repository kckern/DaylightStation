import { describe, it, expect } from 'vitest';
import { conceptMastery } from '#domains/school/progress/conceptMastery.mjs';

const NOW = '2026-09-30T00:00:00.000Z';

/** A minimal `school.learning-evidence/v1`-shaped entry for aggregation tests. */
function entry({
  conceptIds = ['fractions-add'],
  responses = 1,
  correct = 1,
  graded = true,
  occurredAt = '2026-09-15T00:00:00.000Z',
} = {}) {
  return {
    activity: { graded },
    learning: { conceptIds },
    measures: { responses, correct },
    occurredAt,
  };
}

describe('conceptMastery', () => {
  it('honors threshold: below-threshold ratio is not mastered even with enough responses', () => {
    // 3/5 = 0.6, below the default 0.8 threshold.
    const entries = Array.from({ length: 5 }, (_, i) => entry({ correct: i < 3 ? 1 : 0 }));
    const [row] = conceptMastery(entries, { now: NOW });
    expect(row).toMatchObject({
      conceptId: 'fractions-add', responses: 5, correct: 3, ratio: 0.6, mastered: false,
    });
  });

  it('honors threshold: at-or-above-threshold ratio with enough responses IS mastered', () => {
    // 4/5 = 0.8, exactly the default threshold.
    const entries = Array.from({ length: 5 }, (_, i) => entry({ correct: i < 4 ? 1 : 0 }));
    const [row] = conceptMastery(entries, { now: NOW });
    expect(row).toMatchObject({ ratio: 0.8, mastered: true });
  });

  it('honors minResponses: a perfect ratio below the response floor is NOT mastered', () => {
    // 2/2 = 1.0 but only 2 responses, below the default minResponses of 5.
    const entries = [entry({ responses: 1, correct: 1 }), entry({ responses: 1, correct: 1 })];
    const [row] = conceptMastery(entries, { now: NOW });
    expect(row).toMatchObject({ responses: 2, ratio: 1, mastered: false });
  });

  it('custom threshold/minResponses are honored over the defaults', () => {
    // 3/4 = 0.75: fails the default 0.8 threshold but passes a custom 0.7 one;
    // 4 responses fails the default minResponses of 5 but passes a custom 3.
    const entries = Array.from({ length: 4 }, (_, i) => entry({ correct: i < 3 ? 1 : 0 }));
    const [row] = conceptMastery(entries, { now: NOW, threshold: 0.7, minResponses: 3 });
    expect(row).toMatchObject({ ratio: 0.75, mastered: true });
  });

  it('is weakest-first: lowest ratio sorts first', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => entry({ conceptIds: ['strong'], correct: i < 5 ? 1 : 0 })), // 5/5
      ...Array.from({ length: 5 }, (_, i) => entry({ conceptIds: ['weak'], correct: i < 1 ? 1 : 0 })), // 1/5
      ...Array.from({ length: 5 }, (_, i) => entry({ conceptIds: ['middle'], correct: i < 3 ? 1 : 0 })), // 3/5
    ];
    const rows = conceptMastery(entries, { now: NOW });
    expect(rows.map((r) => r.conceptId)).toEqual(['weak', 'middle', 'strong']);
  });

  it('counts a concept id the domain has never heard of — registry membership is not its concern', () => {
    const entries = [entry({ conceptIds: ['totally-unregistered-id'] })];
    const rows = conceptMastery(entries, { now: NOW });
    expect(rows).toEqual([{
      conceptId: 'totally-unregistered-id', responses: 1, correct: 1, ratio: 1, mastered: false,
    }]);
  });

  it('excludes evidence outside the rolling window', () => {
    const entries = [
      entry({ occurredAt: '2026-06-01T00:00:00.000Z' }), // well outside a 90-day window ending 2026-09-30
      entry({ occurredAt: '2026-09-29T00:00:00.000Z' }), // inside
    ];
    const rows = conceptMastery(entries, { now: NOW, windowDays: 90 });
    expect(rows).toEqual([{
      conceptId: 'fractions-add', responses: 1, correct: 1, ratio: 1, mastered: false,
    }]);
  });

  it('excludes non-graded (self-reported/engagement) evidence from accuracy mastery', () => {
    const entries = [entry({ graded: false })];
    expect(conceptMastery(entries, { now: NOW })).toEqual([]);
  });

  it('a multi-concept entry contributes its full responses/correct to EACH bound concept', () => {
    const entries = [entry({ conceptIds: ['a', 'b'], responses: 2, correct: 1 })];
    const rows = conceptMastery(entries, { now: NOW });
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ conceptId: 'a', responses: 2, correct: 1 }),
      expect.objectContaining({ conceptId: 'b', responses: 2, correct: 1 }),
    ]));
  });

  it('an entry with no bound concepts contributes to nothing', () => {
    const entries = [entry({ conceptIds: [] })];
    expect(conceptMastery(entries, { now: NOW })).toEqual([]);
  });

  it('requires a valid now timestamp — a purely deterministic function never reads the clock itself', () => {
    expect(() => conceptMastery([entry()], {})).toThrow(/now/);
    expect(() => conceptMastery([entry()], { now: 'not-a-date' })).toThrow(/now/);
  });

  it('an empty entries array yields an empty result', () => {
    expect(conceptMastery([], { now: NOW })).toEqual([]);
  });
});
