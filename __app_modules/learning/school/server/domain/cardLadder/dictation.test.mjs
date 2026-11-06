import { describe, expect, it } from 'vitest';
import { applyDictationAttempt, currentDictation, dictationState, nextDictationWord } from './dictation.mjs';

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

describe('applyDictationAttempt edge cases', () => {
  it('clamps blindPasses at the done threshold', () => {
    expect(applyDictationAttempt(word('blind', 2), { step: 'blind', pass: true }, NOW).blindPasses).toBe(2);
  });
  it('an invalid attempt step falls back to the stored step, then to match', () => {
    expect(applyDictationAttempt(word('copy'), { step: 'bogus', pass: true }, NOW).step).toBe('blind');
    expect(applyDictationAttempt(undefined, { step: 'bogus', pass: true }, NOW).step).toBe('copy');
  });
});

describe('dictationState', () => {
  it('dedupes duplicate ids, first occurrence wins, including excluded ones', () => {
    const s = dictationState({ week: 'w', words: ['a', 'a', 'b', 'x', 'x'] }, null, { hasAudio: (id) => id !== 'x', inLexicon: () => true });
    expect(s.words.map((w) => w.id)).toEqual(['a', 'b']);
    expect(s.excluded).toEqual([{ id: 'x', reason: 'needs-recording' }]);
    expect(s.remaining).toBe(2);
    expect(nextDictationWord(dictationState({ week: 'w', words: ['a', 'a'] }, null, all), { lastWordId: 'a' })).toBe('a');
  });
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
    expect(s).toMatchObject({ done: true, finished: true, remaining: 0 });
  });
  it('progress for a different week is ignored', () => {
    const s = dictationState(list, { week: '2026-W44', words: { a: { step: 'blind', blindPasses: 2 } } }, all);
    expect(s.words[0]).toEqual({ id: 'a', step: 'match', blindPasses: 0, done: false });
  });
  it('excludes words without audio and unknown words; nothing is left to drill, but the list is never ready (audit #5)', () => {
    const done = { step: 'blind', blindPasses: 2 };
    const s = dictationState(list, { week: '2026-W45', words: { a: done } }, { hasAudio: (id) => id !== 'b', inLexicon: (id) => id !== 'c' });
    expect(s.excluded).toEqual([{ id: 'b', reason: 'needs-recording' }, { id: 'c', reason: 'unknown-word' }]);
    expect(s.words.map((w) => w.id)).toEqual(['a']);
    expect(s).toMatchObject({ done: false, finished: true, remaining: 0 });
  });
  it('a missing list is not ready and has nothing to drill', () => {
    expect(dictationState(null, null, all)).toMatchObject({ week: null, words: [], done: false, finished: true, remaining: 0 });
  });
  it('an all-excluded list is never ready', () => {
    const s = dictationState(list, null, { hasAudio: () => false, inLexicon: () => true });
    expect(s).toMatchObject({ words: [], done: false, finished: true, remaining: 0 });
    expect(s.excluded).toHaveLength(3);
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

describe('nextDictationWord — a real rotation', () => {
  it('walks three words in list order, wrapping, never serving the same word twice in a row', () => {
    const s = dictationState({ week: 'w', words: ['a', 'b', 'c'] }, null, all);
    const served = [];
    let last = null;
    for (let i = 0; i < 7; i += 1) { last = nextDictationWord(s, { lastWordId: last }); served.push(last); }
    expect(served).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
    for (let i = 1; i < served.length; i += 1) expect(served[i]).not.toBe(served[i - 1]);
  });
  it('keeps rotating as words finish mid-walk', () => {
    const progress = { week: 'w', words: {} };
    const served = [];
    let last = null;
    for (let i = 0; i < 6; i += 1) {
      const s = dictationState({ week: 'w', words: ['a', 'b', 'c'] }, progress, all);
      last = nextDictationWord(s, { lastWordId: last });
      served.push(last);
      if (last === 'b') progress.words.b = { step: 'blind', blindPasses: 2 };
    }
    expect(served).toEqual(['a', 'b', 'c', 'a', 'c', 'a']);
  });
});

describe('nextDictationWord — a miss keeps the word (audit #3)', () => {
  const s = dictationState({ week: 'w', words: ['a', 'b', 'c'] }, null, all);
  it('repeat serves the last word again while it is not done', () => {
    expect(nextDictationWord(s, { lastWordId: 'b', repeat: true })).toBe('b');
  });
  it('without repeat it moves on', () => {
    expect(nextDictationWord(s, { lastWordId: 'b', repeat: false })).toBe('c');
  });
  it('repeat never serves a done word', () => {
    const done = dictationState({ week: 'w', words: ['a', 'b', 'c'] }, { week: 'w', words: { b: { step: 'blind', blindPasses: 2 } } }, all);
    expect(nextDictationWord(done, { lastWordId: 'b', repeat: true })).toBe('c');
  });
});

describe('currentDictation (spec Revision 2: week tags on lexicon entries)', () => {
  const lex = (rows) => ({ package: 'korean-vocab', entries: new Map(rows.map((row) => [row.id, { term: row.id, ...row }])) });
  it('null when no entry is tagged', () => {
    expect(currentDictation(lex([{ id: 'a' }, { id: 'b', dictation: [] }]))).toBeNull();
    expect(currentDictation(null)).toBeNull();
  });
  it('the newest ISO week wins; its words in lexicon order', () => {
    const out = currentDictation(lex([
      { id: 'a', dictation: ['2026-W45'] }, { id: 'b', dictation: ['2026-W46'] }, { id: 'c', dictation: ['2026-W45', '2026-W46'] }, { id: 'd' },
    ]));
    expect(out).toEqual({ week: '2026-W46', words: ['b', 'c'], count: 2 });
  });
  it('compares weeks by year then week number', () => {
    expect(currentDictation(lex([{ id: 'a', dictation: ['2026-W52'] }, { id: 'b', dictation: ['2027-W01'] }])).week).toBe('2027-W01');
  });
  it('dictationOrder for the week sorts first; untagged-order words keep lexicon order after them', () => {
    const out = currentDictation(lex([
      { id: 'a', dictation: ['2026-W46'] },
      { id: 'b', dictation: ['2026-W46'], dictationOrder: { '2026-W46': 2 } },
      { id: 'c', dictation: ['2026-W46'], dictationOrder: { '2026-W46': 1, '2026-W45': 9 } },
    ]));
    expect(out.words).toEqual(['c', 'b', 'a']);
  });
  it('ignores malformed tags', () => {
    expect(currentDictation(lex([{ id: 'a', dictation: ['2026-11-09', 46, null] }, { id: 'b', dictation: '2026-W46' }]))).toBeNull();
  });
  it('counts the words, ten or not (the caller warns)', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `w${i}`, dictation: ['2026-W46'] }));
    expect(currentDictation(lex(rows)).count).toBe(11);
  });
});
