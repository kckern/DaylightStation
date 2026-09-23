import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { buildPractice, practiceWordIds } from './practice.mjs';

const D = '2026-09-22';
const words = {
  a: { ...emptyWordV3(), state: 'familiar' }, b: { ...emptyWordV3(), state: 'mastered', stage: 2 },
  c: { ...emptyWordV3(), state: 'claimed', tricky: true }, d: emptyWordV3(),
  e: { ...emptyWordV3(), state: 'familiar', verifyFailedDay: D },
};
const entries = new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { id, term: `${id}어`, gloss: id.toUpperCase() }]));
const media = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { image: false, audio: true }]));
const build = (mode, extra = {}) => buildPractice({ mode, help: true, filter: 'introduced', chosen: [], words, entries, media, day: D, seed: 's', capabilities: { microphone: true }, frontSide: 'term', ...extra });

describe('practice', () => {
  it('filters', () => {
    expect(practiceWordIds({ filter: 'working', words }).sort()).toEqual(['a', 'c', 'e']);
    expect(practiceWordIds({ filter: 'introduced', words }).sort()).toEqual(['a', 'b', 'c', 'e']);
    expect(practiceWordIds({ filter: 'tricky', words })).toEqual(['c']);
    expect(practiceWordIds({ filter: 'chosen', words, chosen: ['d', 'b'] })).toEqual(['b']);
  });
  it('quiz is verify tasks over non-mastered introduced words not failed today', () => {
    const q = build('quiz').queue;
    expect(q.map((t) => `${t.task}:${t.wordId}`).sort()).toEqual(['2.2:a', '2.2:c', '3.3:a', '3.3:c'].sort());
    expect(q.slice(0, 2).every((t) => t.task === '3.3')).toBe(true);
  });
  it('say needs a mic; write help = copy, no help = type-practice', () => {
    expect(build('say', { capabilities: { microphone: false } }).queue).toEqual([]);
    expect(build('write').queue.every((t) => t.kind === 'copy')).toBe(true);
    expect(build('write', { help: false }).queue.every((t) => t.kind === 'type-practice')).toBe(true);
  });
  it('say-after (help) needs term audio; say-from-cue (no help) does not', () => {
    const mixedMedia = { ...media, a: { image: false, audio: false } };
    const help = build('say', { media: mixedMedia }).queue;
    expect(help.every((t) => t.kind === 'say-after')).toBe(true);
    expect(help.map((t) => t.wordId)).not.toContain('a');
    const noHelp = build('say', { help: false, media: mixedMedia }).queue;
    expect(noHelp.every((t) => t.kind === 'say-from-cue')).toBe(true);
    expect(noHelp.map((t) => t.wordId)).toContain('a');
  });
  it('match makes boards of 4-6, folding short remainders rather than dropping below 4', () => {
    const wordsN = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`w${i}`, { ...emptyWordV3(), state: 'familiar' }]));
    const entriesN = (n) => new Map(Array.from({ length: n }, (_, i) => [`w${i}`, { id: `w${i}`, term: `${i}어`, gloss: `${i}` }]));
    const mediaN = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`w${i}`, { image: false, audio: true }]));
    const sizesFor = (n) => buildPractice({
      mode: 'match', help: true, filter: 'introduced', chosen: [], words: wordsN(n), entries: entriesN(n), media: mediaN(n),
      day: D, seed: 's', capabilities: { microphone: true }, frontSide: 'term',
    }).queue.map((t) => t.board.pairs.length);
    expect(sizesFor(4)).toEqual([4]);
    expect(sizesFor(5)).toEqual([5]);
    expect(sizesFor(6)).toEqual([6]);
    expect(sizesFor(7).sort((x, y) => y - x)).toEqual([4, 3]);
    expect(sizesFor(8).sort((x, y) => y - x)).toEqual([4, 4]);
    expect(sizesFor(9).sort((x, y) => y - x)).toEqual([5, 4]);
    expect(sizesFor(12).sort((x, y) => y - x)).toEqual([6, 6]);
    expect(sizesFor(13).sort((x, y) => y - x)).toEqual([5, 4, 4]);
    sizesFor(13).forEach((size) => expect(size).toBeGreaterThanOrEqual(3));
    [4, 5, 6, 8, 9, 12, 13].forEach((n) => sizesFor(n).forEach((size) => {
      expect(size).toBeGreaterThanOrEqual(4);
      expect(size).toBeLessThanOrEqual(6);
    }));
  });
  it('quiz eligibility is the round-verify rule: familiar/claimed or notYetCarry, not failed today', () => {
    const w = {
      f: { ...emptyWordV3(), state: 'familiar' }, c: { ...emptyWordV3(), state: 'claimed' },
      i: { ...emptyWordV3(), state: 'introduced' }, n: { ...emptyWordV3(), state: 'notYet' },
      nc: { ...emptyWordV3(), state: 'notYet', notYetCarry: true }, m: { ...emptyWordV3(), state: 'mastered', stage: 0 },
      x: { ...emptyWordV3(), state: 'claimed', verifyFailedDay: D },
    };
    const ent = new Map(Object.keys(w).map((id) => [id, { id, term: `${id}어`, gloss: id }]));
    const q = buildPractice({ mode: 'quiz', words: w, entries: ent, media: {}, day: D, seed: 's' }).queue;
    expect([...new Set(q.map((t) => t.wordId))].sort()).toEqual(['c', 'f', 'nc']);
  });
});
