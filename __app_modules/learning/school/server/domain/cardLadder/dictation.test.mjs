import { describe, expect, it } from 'vitest';
import { applyDictationAttempt, dictationState, nextDictationWord } from './dictation.mjs';

const NOW = '2026-11-06T10:00:00.000Z';
const all = { hasAudio: () => true, inLexicon: () => true };
const list = { week: '2026-W45', words: ['a', 'b', 'c'] };
const word = (step, blindPasses = 0) => ({ step, blindPasses, lastAttemptAt: null });

describe('applyDictationAttempt', () => {
  it('a fresh word starts in match; a pass moves it to copy', () => {
    expect(applyDictationAttempt(undefined, { step: 'match', pass: true }, NOW)).toEqual({ step: 'copy', blindPasses: 0, lastAttemptAt: NOW });
  });
  it('copy pass -> blind', () => {
    expect(applyDictationAttempt(word('copy'), { step: 'copy', pass: true }, NOW).step).toBe('blind');
  });
  it('blind pass increments blindPasses and stays in blind', () => {
    expect(applyDictationAttempt(word('blind'), { step: 'blind', pass: true }, NOW)).toEqual({ step: 'blind', blindPasses: 1, lastAttemptAt: NOW });
  });
  it('a miss in match stays in match', () => {
    expect(applyDictationAttempt(word('match'), { step: 'match', pass: false }, NOW).step).toBe('match');
  });
  it('a miss in copy goes back to match; in blind back to copy', () => {
    expect(applyDictationAttempt(word('copy'), { step: 'copy', pass: false }, NOW).step).toBe('match');
    expect(applyDictationAttempt(word('blind'), { step: 'blind', pass: false }, NOW).step).toBe('copy');
  });
  it("Don't-know is a miss even when pass is true", () => {
    expect(applyDictationAttempt(word('blind', 1), { step: 'blind', pass: true, dontKnow: true }, NOW)).toEqual({ step: 'copy', blindPasses: 1, lastAttemptAt: NOW });
    expect(applyDictationAttempt(word('match'), { step: 'match', dontKnow: true }, NOW).step).toBe('match');
  });
  it('a miss never loses earned blind passes', () => {
    expect(applyDictationAttempt(word('blind', 1), { step: 'blind', pass: false }, NOW).blindPasses).toBe(1);
  });
  it('does not mutate its input and accepts a ms clock', () => {
    const w = word('copy'); applyDictationAttempt(w, { step: 'copy', pass: true }, 0);
    expect(w).toEqual(word('copy'));
    expect(applyDictationAttempt(w, { step: 'copy', pass: true }, 0).lastAttemptAt).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('dictationState', () => {
  it('everything is fresh with no progress', () => {
    const s = dictationState(list, null, all);
    expect(s).toMatchObject({ week: '2026-W45', done: false, remaining: 3, excluded: [] });
    expect(s.words).toEqual([
      { id: 'a', step: 'match', blindPasses: 0, done: false },
      { id: 'b', step: 'match', blindPasses: 0, done: false },
      { id: 'c', step: 'match', blindPasses: 0, done: false },
    ]);
  });
  it('done at two blind passes, even non-consecutive', () => {
    let w = applyDictationAttempt(word('blind'), { step: 'blind', pass: true }, NOW);
    w = applyDictationAttempt(w, { step: 'blind', pass: false }, NOW);
    expect(w.step).toBe('copy');
    w = applyDictationAttempt(w, { step: 'copy', pass: true }, NOW);
    w = applyDictationAttempt(w, { step: 'blind', pass: true }, NOW);
    expect(w.blindPasses).toBe(2);
    const s = dictationState(list, { week: '2026-W45', words: { a: w } }, all);
    expect(s.words[0].done).toBe(true);
    expect(s.remaining).toBe(2);
    expect(s.done).toBe(false);
  });
  it('done when every word is done', () => {
    const done = { step: 'blind', blindPasses: 2 };
    const s = dictationState(list, { week: '2026-W45', words: { a: done, b: done, c: done } }, all);
    expect(s).toMatchObject({ done: true, remaining: 0 });
  });
  it('progress for a different week is ignored', () => {
    const s = dictationState(list, { week: '2026-W44', words: { a: { step: 'blind', blindPasses: 2 } } }, all);
    expect(s.words[0]).toEqual({ id: 'a', step: 'match', blindPasses: 0, done: false });
  });
  it('excludes words without audio and unknown words; they do not block done', () => {
    const done = { step: 'blind', blindPasses: 2 };
    const s = dictationState(list, { week: '2026-W45', words: { a: done } }, { hasAudio: (id) => id !== 'b', inLexicon: (id) => id !== 'c' });
    expect(s.excluded).toEqual([{ id: 'b', reason: 'needs-recording' }, { id: 'c', reason: 'unknown-word' }]);
    expect(s.words.map((w) => w.id)).toEqual(['a']);
    expect(s).toMatchObject({ done: true, remaining: 0 });
  });
  it('a missing list is done with nothing', () => {
    expect(dictationState(null, null, all)).toMatchObject({ week: null, words: [], done: true, remaining: 0 });
  });
});

describe('nextDictationWord', () => {
  const stateOf = (doneIds) => dictationState(list, { week: '2026-W45', words: Object.fromEntries(doneIds.map((id) => [id, { step: 'blind', blindPasses: 2 }])) }, all);
  it('starts at the first not-done word', () => {
    expect(nextDictationWord(stateOf([]), {})).toBe('a');
  });
  it('cycles after the last word and skips done ones', () => {
    expect(nextDictationWord(stateOf([]), { lastWordId: 'a' })).toBe('b');
    expect(nextDictationWord(stateOf([]), { lastWordId: 'c' })).toBe('a');
    expect(nextDictationWord(stateOf(['b']), { lastWordId: 'a' })).toBe('c');
  });
  it('never repeats the same word when more than one remains', () => {
    expect(nextDictationWord(stateOf(['c']), { lastWordId: 'b' })).toBe('a');
  });
  it('serves the last remaining word again', () => {
    expect(nextDictationWord(stateOf(['a', 'b']), { lastWordId: 'c' })).toBe('c');
  });
  it('null when everything is done', () => {
    expect(nextDictationWord(stateOf(['a', 'b', 'c']), { lastWordId: 'a' })).toBeNull();
  });
});
