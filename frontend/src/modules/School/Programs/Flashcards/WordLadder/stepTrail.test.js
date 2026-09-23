import { describe, expect, it } from 'vitest';
import { STEP_HINTS, stepTrail } from './stepTrail.js';

const base = { rechecksLeft: 0, rechecksTotal: 0, roundsDone: 0, learnToday: true, doneToday: false, round: null, drill: null, practice: null, activeMs: 0, capMs: 900000 };
const round = (phase, extra = {}) => ({ ...base, phase: 'round', round: { index: 1, kind: 'new', size: 4, phase, remainingInStream: 3, quizLeft: 2 }, ...extra });
const states = (trail) => Object.fromEntries(trail.steps.map((s) => [s.id, s.state]));

describe('stepTrail — the sitting header\'s Review › Learn › Sort › Quiz › Practice', () => {
  it('rechecks: Review is lit, round steps ahead, Practice locked with its note', () => {
    const trail = stepTrail({ ...base, phase: 'rechecks', rechecksLeft: 2, rechecksTotal: 3 });
    expect(trail.current).toBe('review');
    expect(states(trail)).toEqual({ review: 'current', learn: 'todo', sort: 'todo', quiz: 'todo', practice: 'todo' });
    expect(trail.steps.at(-1)).toMatchObject({ id: 'practice', locked: true, note: 'after today\'s words' });
  });

  it('omits Review when no rechecks are due', () => {
    expect(stepTrail(round('intro')).steps.map((s) => s.id)).toEqual(['learn', 'sort', 'quiz', 'practice']);
  });

  it('learn → sort → quiz: earlier steps ticked, the current one lit, later ones dim', () => {
    const withReview = { rechecksTotal: 2, rechecksLeft: 0 };
    expect(states(stepTrail(round('intro', withReview)))).toEqual({ review: 'done', learn: 'current', sort: 'todo', quiz: 'todo', practice: 'todo' });
    expect(states(stepTrail(round('stream', withReview)))).toEqual({ review: 'done', learn: 'done', sort: 'current', quiz: 'todo', practice: 'todo' });
    expect(states(stepTrail(round('quiz', withReview)))).toEqual({ review: 'done', learn: 'done', sort: 'done', quiz: 'current', practice: 'todo' });
    // The drill offer comes after the quiz: the quiz stays the lit step.
    expect(stepTrail(round('offer')).current).toBe('quiz');
  });

  it('the guided Match after a round\'s quiz: lit in phase match, or on a round-sourced match item; absent otherwise', () => {
    const inMatch = stepTrail(round('match'));
    expect(inMatch.current).toBe('match');
    expect(states(inMatch)).toEqual({ learn: 'done', sort: 'done', quiz: 'done', match: 'current', practice: 'todo' });
    expect(inMatch.subLine).toBe('Round 1 · Match');
    expect(stepTrail(round('quiz'), { type: 'match', source: 'round' }).current).toBe('match');
    // A practice match is Practice, not the round's Match.
    expect(stepTrail({ ...base, phase: 'practice', doneToday: true, roundsDone: 1 }, { type: 'match', source: 'practice' }).current).toBe('practice');
    // A round that says it has a Match shows it ahead of time.
    const ahead = round('stream');
    ahead.round.hasMatch = true;
    expect(states(stepTrail(ahead))).toMatchObject({ quiz: 'todo', match: 'todo' });
    expect(stepTrail(round('stream')).steps.map((s) => s.id)).not.toContain('match');
  });

  it('a carry round (no new words) has no Learn step', () => {
    const carry = { ...round('stream', { learnToday: false }) };
    carry.round.kind = 'carry';
    expect(stepTrail(carry).steps.map((s) => s.id)).toEqual(['sort', 'quiz', 'practice']);
  });

  it('a running tricky drill inserts a lit Drill step before Practice', () => {
    const trail = stepTrail({ ...base, phase: 'drill', drill: { at: 2, of: 6 }, roundsDone: 1 });
    expect(trail.current).toBe('drill');
    expect(trail.steps.map((s) => [s.id, s.state])).toEqual([['learn', 'done'], ['sort', 'done'], ['quiz', 'done'], ['drill', 'current'], ['practice', 'todo']]);
  });

  it('done for today: everything ticked, Practice unlocked but dim (no note)', () => {
    const trail = stepTrail({ ...base, phase: 'summary', roundsDone: 2, doneToday: true });
    expect(trail.current).toBe(null);
    expect(states(trail)).toEqual({ learn: 'done', sort: 'done', quiz: 'done', practice: 'todo' });
    expect(trail.steps.at(-1)).toMatchObject({ locked: false, note: null });
  });

  it('practice mode lights Practice — the run, or the menu that starts one', () => {
    expect(stepTrail({ ...base, phase: 'practice', practice: { mode: 'match', at: 1, of: 5 }, roundsDone: 1, doneToday: true }).current).toBe('practice');
    expect(stepTrail({ ...base, phase: 'summary', roundsDone: 1, doneToday: true }, { type: 'menu' }).current).toBe('practice');
    expect(stepTrail({ ...base, phase: 'summary', roundsDone: 1, doneToday: true }, { type: 'flashcard', source: 'practice' }).current).toBe('practice');
  });

  it('a day with no rounds at all shows no Sort or Quiz once it is done', () => {
    const trail = stepTrail({ ...base, phase: 'summary', doneToday: true, rechecksTotal: 2, learnToday: false });
    expect(trail.steps.map((s) => s.id)).toEqual(['review', 'practice']);
  });

  it('the sub-line: "Round N · step", or the phase\'s own words outside a round', () => {
    expect(stepTrail(round('intro')).subLine).toBe('Round 1 · New words');
    expect(stepTrail(round('stream')).subLine).toBe('Round 1 · Sort');
    expect(stepTrail(round('quiz')).subLine).toBe('Round 1 · Quiz');
    expect(stepTrail(round('offer')).subLine).toBe('Round 1 · Tricky word');
    expect(stepTrail({ ...base, phase: 'rechecks', rechecksLeft: 1, rechecksTotal: 1 }).subLine).toBe('Checking 1 word');
    expect(stepTrail({ ...base, phase: 'summary', doneToday: true }).subLine).toBe('Done for today');
    expect(stepTrail(null).subLine).toBe('');
  });

  it('the Match hint', () => {
    expect(STEP_HINTS.match).toBe('Match each word to its meaning.');
  });

  it('every step has a kid-readable hint with no jargon', () => {
    for (const id of ['review', 'learn', 'sort', 'quiz', 'match', 'drill', 'practice']) {
      expect(STEP_HINTS[id]).toMatch(/\w/);
      expect(STEP_HINTS[id]).not.toMatch(/verify|recheck|claimed/i);
    }
  });
});
