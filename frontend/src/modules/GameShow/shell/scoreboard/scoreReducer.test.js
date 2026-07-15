import { describe, it, expect } from 'vitest';
import { scoreReducer, initScores } from './scoreReducer.js';

const TEAMS = [{ id: 'team_1' }, { id: 'team_2' }];

describe('scoreReducer', () => {
  it('initScores zeroes every team', () => {
    expect(initScores(TEAMS)).toEqual({ team_1: 0, team_2: 0 });
  });
  it('awards, deducts (can go negative), sets, restores', () => {
    let s = initScores(TEAMS);
    s = scoreReducer(s, { type: 'AWARD', teamId: 'team_1', points: 400 });
    expect(s.team_1).toBe(400);
    s = scoreReducer(s, { type: 'DEDUCT', teamId: 'team_1', points: 600 });
    expect(s.team_1).toBe(-200);
    s = scoreReducer(s, { type: 'SET_SCORE', teamId: 'team_2', points: 1000 });
    expect(s.team_2).toBe(1000);
    s = scoreReducer(s, { type: 'RESTORE', scores: { team_1: 5, team_2: 6 } });
    expect(s).toEqual({ team_1: 5, team_2: 6 });
  });
  it('ignores unknown teams and unknown actions', () => {
    let s = initScores(TEAMS);
    expect(scoreReducer(s, { type: 'AWARD', teamId: 'ghost', points: 100 })).toEqual(s);
    expect(scoreReducer(s, { type: 'NOPE' })).toEqual(s);
  });
});
