import { describe, it, expect } from 'vitest';
import { hostButtons } from "./hostView.js";

describe('hostButtons', () => {
  it('round-intro → start', () => {
    expect(hostButtons({ phase: 'round-intro', roundIndex: 0, used: {} })).toEqual([
      { label: 'Start game', command: { type: 'START_ROUND' }, tone: 'primary' },
    ]);
  });
  it('clue unrevealed → reveal + timeout; revealed → back to board', () => {
    const un = hostButtons({ phase: 'clue', revealed: false }).map((b) => b.command.type);
    expect(un).toEqual(['REVEAL', 'TIMEOUT']);
    const rev = hostButtons({ phase: 'clue', revealed: true }).map((b) => b.command.type);
    expect(rev).toEqual(['RETURN_TO_BOARD']);
  });
  it('judging → correct/wrong, plus reveal when hidden', () => {
    const hidden = hostButtons({ phase: 'judging', revealed: false }).map((b) => b.command.type);
    expect(hidden).toEqual(['REVEAL', 'JUDGE', 'JUDGE']);
    const shown = hostButtons({ phase: 'judging', revealed: true });
    expect(shown.map((b) => b.command.type)).toEqual(['JUDGE', 'JUDGE']);
    expect(shown[0].command.correct).toBe(true);
    expect(shown[1].command.correct).toBe(false);
  });
  it('final phases and unknown/empty', () => {
    expect(hostButtons({ phase: 'final-category' })[0].command.type).toBe('START_ROUND');
    expect(hostButtons({ phase: 'final-clue' })[0].command.type).toBe('REVEAL');
    expect(hostButtons({ phase: 'board' })).toEqual([]);
    expect(hostButtons(null)).toEqual([]);
  });
});

it('later introductions start a round', () => expect(hostButtons({phase:'round-intro',roundIndex:1,used:{}})[0].label).toBe('Start round'));

it('review requires judgment before advancing and round completion is a host decision', () => {
 expect(hostButtons({phase:'answer-review',answerReview:{judgmentPending:true}}).map(b=>b.command.type)).toEqual(['JUDGE','JUDGE']);
 expect(hostButtons({phase:'answer-review',answerReview:{judgmentPending:false}})[0].command.type).toBe('RETURN_TO_BOARD');
 expect(hostButtons({phase:'round-decision'}).map(b=>b.command.type)).toEqual(['CONTINUE_ROUND','FINISH_GAME']);
 expect(hostButtons({phase:'clue',answeringTeamId:'blue',jeopardyFlowVersion:2}).map(b=>b.command.type)).toContain('JUDGE');
});

it('a judged clue with a learn note offers the note beside Next question; open, it offers Hide', () => {
 const learn = { text: 'Before I formed you…' };
 const review = { phase: 'answer-review', answerReview: { judgmentPending: false }, active: { clue: { learn } } };
 expect(hostButtons(review).map(b => b.command.type)).toEqual(['SHOW_LEARN', 'RETURN_TO_BOARD']);
 expect(hostButtons({ ...review, learning: true }).map(b => b.command.type)).toEqual(['HIDE_LEARN', 'RETURN_TO_BOARD']);
 expect(hostButtons({ ...review, answerReview: { judgmentPending: true } }).map(b => b.command.type)).toEqual(['JUDGE', 'JUDGE']);
 expect(hostButtons({ ...review, active: { clue: {} } }).map(b => b.command.type)).toEqual(['RETURN_TO_BOARD']);
 expect(hostButtons({ phase: 'final-judging', set: { final: { learn } } }).map(b => b.command.type)).toEqual(['SHOW_LEARN']);
 expect(hostButtons({ phase: 'final-judging', set: { final: {} } })).toEqual([]);
});
