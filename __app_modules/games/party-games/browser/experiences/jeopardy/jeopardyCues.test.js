import { describe, expect, it, vi } from 'vitest';
import { JEOPARDY_PACK, actionCue, phaseCues, consumePresentationEvents } from './jeopardyCues.js';

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

it('baselines silently, consumes bursts in order once, and skips missing history', () => {
  const cursor = { seq: null }; const play = vi.fn(); const gap = vi.fn();
  consumePresentationEvents(cursor, { presentationSeq: 2, presentationEvents: [{ seq: 2, type: 'BUZZ' }] }, { play, gap });
  expect(play).not.toHaveBeenCalled();
  const snapshot = { presentationSeq: 4, presentationEvents: [{ seq: 3, type: 'BUZZ' }, { seq: 4, type: 'REVEAL' }] };
  consumePresentationEvents(cursor, snapshot, { play, gap });
  consumePresentationEvents(cursor, snapshot, { play, gap });
  expect(play.mock.calls.map(([cue]) => cue)).toEqual(['buzz', 'reveal']);
  consumePresentationEvents(cursor, { presentationSeq: 40, presentationEvents: [{ seq: 40, type: 'BUZZ' }] }, { play, gap });
  expect(gap).toHaveBeenCalledOnce(); expect(play).toHaveBeenCalledTimes(2);
});
