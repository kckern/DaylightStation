import { describe, expect, it } from 'vitest';
import { JEOPARDY_PACK, actionCue, phaseCues } from './jeopardyCues.js';

describe('jeopardy cues', () => {
  it('maps host actions to sfx', () => {
    expect(actionCue({ type: 'JUDGE', correct: true })).toBe('correct');
    expect(actionCue({ type: 'JUDGE_FINAL', correct: false })).toBe('wrong');
    expect(actionCue({ type: 'SELECT_AT' })).toBe('reveal');
    expect(actionCue({ type: 'START_ROUND' })).toBe('board-fill');
    expect(actionCue({ type: 'TIMEOUT' })).toBe('time-up');
    expect(actionCue({ type: 'MOVE_CURSOR' })).toBe(null);
  });
  it('maps phases to music and stings', () => {
    expect(phaseCues('round-intro')).toEqual({ music: 'theme', sting: null });
    expect(phaseCues('final-clue')).toEqual({ music: 'think', sting: null });
    expect(phaseCues('wager')).toEqual({ music: null, sting: 'daily-double' });
    expect(phaseCues('board')).toEqual({ music: null, sting: null });
    expect(JEOPARDY_PACK).toBe('jeopardy');
  });
});
