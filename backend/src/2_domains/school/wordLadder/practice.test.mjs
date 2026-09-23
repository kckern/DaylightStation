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
  it('match makes boards of up to six', () => {
    expect(build('match').queue).toHaveLength(1);
    expect(build('match').queue[0].board.pairs).toHaveLength(4);
  });
});
