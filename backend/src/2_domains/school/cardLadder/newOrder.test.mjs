import { describe, expect, it } from 'vitest';
import { orderNewWords } from './rounds.mjs';
import { resolveSettings, DEFAULT_SETTINGS } from './settings.mjs';

const groups = [{ deckId: 'd1', ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, { deckId: 'd2', ids: ['i', 'j', 'k'] }];

describe('orderNewWords (batch.order)', () => {
  it('deck keeps the authored order', () => {
    expect(orderNewWords(groups, { order: 'deck', learnerId: 'learner-a' })).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
  });
  it('random is a stable per-learner shuffle within each deck; earlier decks stay first', () => {
    const one = orderNewWords(groups, { order: 'random', learnerId: 'learner-a' });
    expect(orderNewWords(groups, { order: 'random', learnerId: 'learner-a' })).toEqual(one);
    expect(one.slice(0, 8).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(one.slice(8).sort()).toEqual(['i', 'j', 'k']);
    expect(one.slice(0, 8)).not.toEqual(groups[0].ids);
    expect(orderNewWords(groups, { order: 'random', learnerId: 'learner-b' })).not.toEqual(one);
  });
  it('a word in two decks appears once, where it first comes', () => {
    const out = orderNewWords([{ deckId: 'd1', ids: ['a', 'b'] }, { deckId: 'd2', ids: ['b', 'c'] }], { order: 'deck' });
    expect(out).toEqual(['a', 'b', 'c']);
  });
});

describe('settings: batch.order', () => {
  it('defaults to random; config may set deck; anything else keeps the default', () => {
    expect(DEFAULT_SETTINGS.batch.order).toBe('random');
    expect(resolveSettings({ settings: { batch: { order: 'deck' } } }).batch.order).toBe('deck');
    expect(resolveSettings({ settings: { batch: { order: 'alphabetical' } } }).batch.order).toBe('random');
  });
});
