import { describe, expect, it } from 'vitest';
import {
  answerSheetIdenticon, cardDigitDistance, identiconCellDistance,
  isAcceptablyDistinctCardId, mintDistinctCardId,
} from './answerSheetIdentity.mjs';

function digitsRng(ids) {
  const digits = ids.join('').split('').map(Number);
  let index = 0;
  return () => (digits[index++] + 0.1) / 10;
}

describe('answer-sheet identicon', () => {
  it('is deterministic, versioned, monochrome, and card-specific', () => {
    const first = answerSheetIdenticon('8684155');
    expect(first).toEqual(answerSheetIdenticon('8684155'));
    expect(first).toMatchObject({ version: 'v1', size: 5 });
    expect(first.cells).toHaveLength(25);
    expect(first.cells.every((cell) => typeof cell === 'boolean')).toBe(true);
    expect(identiconCellDistance(first, answerSheetIdenticon('9427608'))).toBeGreaterThanOrEqual(8);
  });
});

describe('distinct Student No. generation', () => {
  it('rejects a confusable candidate and accepts one meeting every distance rule', () => {
    const id = mintDistinctCardId({
      rng: digitsRng(['8684995', '9427608']),
      predecessorCardId: '8684155',
      activeCardIds: ['8684155'],
      usedCardIds: ['8684155'],
      maxAttempts: 2,
    });
    expect(id).toBe('9427608');
    expect(cardDigitDistance(id, '8684155')).toBeGreaterThanOrEqual(4);
    expect(id[0]).not.toBe('8');
    expect(id.at(-1)).not.toBe('5');
  });

  it('checks every concurrently active card, not only the predecessor', () => {
    expect(isAcceptablyDistinctCardId('9427608', {
      predecessorCardId: '8684155', activeCardIds: ['8684155', '9427609'],
    })).toBe(false);
  });

  it('fails loudly after bounded retries instead of weakening constraints', () => {
    expect(() => mintDistinctCardId({
      rng: digitsRng(['8684155', '8684155']),
      predecessorCardId: '8684155', activeCardIds: ['8684155'], maxAttempts: 2,
    })).toThrow(/after 2 attempts/);
  });

  it('property: accepted ids satisfy uniqueness, endpoint, digit, and icon distance constraints', () => {
    let state = 0x12345678;
    const rng = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    let predecessor = '8684155';
    const active = [predecessor];
    for (let index = 0; index < 40; index += 1) {
      const candidate = mintDistinctCardId({ rng, predecessorCardId: predecessor, activeCardIds: active });
      expect(isAcceptablyDistinctCardId(candidate, { predecessorCardId: predecessor, activeCardIds: active })).toBe(true);
      active.push(candidate);
      predecessor = candidate;
      // Household-scale active sets are small; retain the last four for this
      // property run so the bounded generator remains representative.
      if (active.length > 4) active.shift();
    }
  });
});
