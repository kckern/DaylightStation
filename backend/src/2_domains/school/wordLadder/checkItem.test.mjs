import { describe, expect, it } from 'vitest';
import {
  CHECK_DIRECTIONS, answerFor, buildChoices, checkDirection, resolveDirection, seededShuffle,
} from './index.mjs';

const gawi = {
  id: 'gawi', kind: 'word', group: 'week-01', term: '가위', gloss: 'Scissors', pronunciation: null,
  decoys: { term: ['가지', '바위', '가방', '가수'], gloss: ['Knife', 'Tape', 'Ruler'] },
};

describe('check items', () => {
  it('picks a direction deterministically from word + study day, rotating across days', () => {
    expect(checkDirection('gawi', '2026-09-22')).toBe(checkDirection('gawi', '2026-09-22'));
    const seen = new Set();
    for (let d = 1; d <= 30; d += 1) seen.add(checkDirection('gawi', `2026-10-${String(d).padStart(2, '0')}`));
    expect([...seen].sort()).toEqual([...CHECK_DIRECTIONS].sort());
  });
  it('falls back to term→gloss when the direction needs missing media', () => {
    for (let d = 1; d <= 30; d += 1) {
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      expect(resolveDirection('gawi', day, { image: false, audio: false })).toBe('term_to_gloss');
      expect(resolveDirection('gawi', day, { image: true, audio: true })).toBe(checkDirection('gawi', day));
    }
  });
  it('builds four unique choices: the answer plus three authored decoys of the right side', () => {
    for (const direction of CHECK_DIRECTIONS) {
      const { answer, choices } = buildChoices(gawi, direction, '2026-09-22');
      expect(answer).toBe(answerFor(gawi, direction));
      expect(choices).toHaveLength(4);
      expect(new Set(choices).size).toBe(4);
      expect(choices).toContain(answer);
      const pool = direction === 'term_to_gloss' ? gawi.decoys.gloss : gawi.decoys.term;
      choices.filter((choice) => choice !== answer).forEach((decoy) => expect(pool).toContain(decoy));
    }
  });
  it('is stable for a reload of the same study day', () => {
    expect(buildChoices(gawi, 'picture_to_term', '2026-09-22')).toEqual(buildChoices(gawi, 'picture_to_term', '2026-09-22'));
  });
  it('shuffles deterministically and never loses items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    expect([...seededShuffle(items, 42)].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('refuses an unknown direction', () => {
    expect(() => buildChoices(gawi, 'sideways', '2026-09-22')).toThrow(/unknown check direction/);
  });
});
