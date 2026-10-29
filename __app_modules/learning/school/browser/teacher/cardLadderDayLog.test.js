import { describe, expect, it } from 'vitest';
import { describeResponse, describeStep, minutesOf, outcomeOf } from './cardLadderDayLog.js';

describe('cardLadderDayLog', () => {
  it('names a step by its task code first, then its drill/intro step, then its kind', () => {
    expect(describeStep({ kind: 'quiz', task: '3.1' })).toEqual({ section: 'Quiz', activity: 'Pick the word' });
    expect(describeStep({ kind: 'drill', step: 'tiles' })).toEqual({ section: 'Tricky-word drill', activity: 'Syllable tiles' });
    expect(describeStep({ kind: 'intro', step: 'flash' })).toEqual({ section: 'Intro', activity: 'New card' });
    expect(describeStep({ kind: 'sort' })).toEqual({ section: 'Sort', activity: 'Sort the card' });
    expect(describeStep({ kind: 'mystery' })).toEqual({ section: 'Step', activity: null });
  });

  it('says what the learner did in words, never a field name', () => {
    expect(describeResponse({ typed: '가이' })).toBe('“가이”');
    expect(describeResponse({ typed: '' })).toBe('(left blank)');
    expect(describeResponse({ choice: '심부름' })).toBe('심부름');
    expect(describeResponse({ dontKnow: true })).toBe('Didn’t know');
    expect(describeResponse({ tiles: ['심', '부', '름'] })).toBe('심부름');
    expect(describeResponse({ sort: 'notYet' })).toBe('Not yet');
    expect(describeResponse({ sort: 'claimed' })).toBe('Got it');
    expect(describeResponse({ drill: 'yes' })).toBe('Took the drill');
    expect(describeResponse({ seen: true })).toBe('Saw the card');
    expect(describeResponse({ done: true })).toBe('Done');
    expect(describeResponse(null)).toBe('—');
  });

  it('gives a verdict only where the engine gave one', () => {
    expect(outcomeOf({ correct: true })).toBe('right');
    expect(outcomeOf({ correct: false })).toBe('wrong');
    expect(outcomeOf({ correct: null })).toBe('ungraded');
  });

  it('reads active time as minutes and seconds', () => {
    expect(minutesOf(207252)).toBe('3 min 27 s');
    expect(minutesOf(120000)).toBe('2 min');
    expect(minutesOf(45000)).toBe('45 s');
    expect(minutesOf(null)).toBeNull();
  });
});
