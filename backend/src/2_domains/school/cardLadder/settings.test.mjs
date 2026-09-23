import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings, cardLadderConfigOf } from './settings.mjs';

describe('resolveSettings', () => {
  it('defaults', () => { expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS); });
  it('merges and clamps', () => {
    const s = resolveSettings({ settings: { round: { size: 99 }, session: { capMinutes: 20 } }, bounds: { 'round.size': [3, 7] } });
    expect(s.round.size).toBe(7);
    expect(s.session.capMinutes).toBe(20);
    expect(s.batch.newPerDay).toBe(4);
  });
});

describe('cardLadderConfigOf', () => {
  it('reads card_ladder, falls back to the pre-rename word_ladder key, and never merges the two', () => {
    expect(cardLadderConfigOf({ card_ladder: { judge: { model: 'a' } } })).toEqual({ judge: { model: 'a' } });
    expect(cardLadderConfigOf({ word_ladder: { judge: { model: 'b' } } })).toEqual({ judge: { model: 'b' } });
    expect(cardLadderConfigOf({ card_ladder: { stage: { screen: 'x' } }, word_ladder: { judge: { model: 'b' } } })).toEqual({ stage: { screen: 'x' } });
    expect(cardLadderConfigOf(null)).toEqual({});
    expect(cardLadderConfigOf({})).toEqual({});
  });
});
