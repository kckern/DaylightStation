import { describe, expect, it } from 'vitest';
import { isCardLadderMode, isCardLadderPolicy } from './cardLadderMode.js';

describe('isCardLadderPolicy', () => {
  it('accepts the canonical mode and the pre-rename alias', () => {
    expect(isCardLadderPolicy({ mode: 'card-ladder' })).toBe(true);
    expect(isCardLadderPolicy({ mode: 'word-ladder' })).toBe(true);
  });
  it('rejects fsrs, a missing policy and anything else', () => {
    expect(isCardLadderPolicy({ mode: 'fsrs' })).toBe(false);
    expect(isCardLadderPolicy(null)).toBe(false);
    expect(isCardLadderMode('leitner')).toBe(false);
  });
});
