import { describe, it, expect } from 'vitest';
import { initJeopardy, jeopardyReducer, scoreDelta, boardDone, snapshot } from './jeopardyReducer.js';

const TEAM_IDS = ['team_1', 'team_2'];

function makeSet({ mode = 'hosted', withFinal = true, penalize = true } = {}) {
  return {
    id: 's', title: 'S', description: '',
    rounds: [{
      name: 'R1', mode, multiplier: 1, timer_seconds: null, penalize_wrong: penalize,
      categories: [
        { name: 'CatA', clues: [
          { value: 100, clue: 'a1', answer: 'A1', media: null, daily_double: false },
          { value: 200, clue: 'a2', answer: 'A2', media: null, daily_double: true },
        ] },
        { name: 'CatB', clues: [
          { value: 100, clue: 'b1', answer: 'B1', media: null, daily_double: false },
        ] },
      ],
    }],
    final: withFinal ? { category: 'Fin', clue: 'f', answer: 'F', media: null } : null,
  };
}

function toBoard(set = makeSet()) {
  let s = initJeopardy(set, TEAM_IDS);
  expect(s.phase).toBe('round-intro');
  s = jeopardyReducer(s, { type: 'START_ROUND' });
  expect(s.phase).toBe('board');
  return s;
}

describe('jeopardyReducer — hosted mode', () => {
  it('select → buzz → correct: scores, marks used, winner picks next', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' }); // cursor at 0,0
    expect(s.phase).toBe('clue');
    expect(s.active.clue.clue).toBe('a1');
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    expect(s.phase).toBe('judging');
    expect(scoreDelta(s, true)).toEqual({ teamId: 'team_2', delta: 100 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
    expect(s.used['0:0:0']).toBe(true);
    expect(s.turnTeamId).toBe('team_2');
  });

  it('wrong answer re-opens the clue for remaining teams; all-wrong reveals', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' });
    expect(scoreDelta(s, false)).toEqual({ teamId: 'team_1', delta: -100 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.phase).toBe('clue');
    expect(s.attempted).toEqual(['team_1']);
    expect(s.answeringTeamId).toBe(null);
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' }); // repeat buzz ignored
    expect(s.phase).toBe('clue');
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.revealed).toBe(true); // everyone missed → answer shows
    s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
    expect(s.phase).toBe('board');
    expect(s.used['0:0:0']).toBe(true);
  });

  it('no penalty when penalize_wrong is false', () => {
    let s = toBoard(makeSet({ penalize: false }));
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' });
    expect(scoreDelta(s, false)).toEqual({ teamId: 'team_1', delta: 0 });
  });

  it('timeout reveals; return marks used', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'TIMEOUT' });
    expect(s.revealed).toBe(true);
    s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
    expect(s.used['0:0:0']).toBe(true);
  });
});

describe('daily double', () => {
  it('selecting a daily-double goes to wager; delta uses the wager', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'MOVE_CURSOR', dir: 'down' }); // row 1 (a2, DD)
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    expect(s.phase).toBe('wager');
    expect(s.isDailyDouble).toBe(true);
    expect(s.answeringTeamId).toBe('team_1'); // turn team answers a DD
    s = jeopardyReducer(s, { type: 'SET_WAGER', amount: 500 });
    expect(s.phase).toBe('clue');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    expect(scoreDelta(s, true)).toEqual({ teamId: 'team_1', delta: 500 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.phase).toBe('board'); // DD: only one team answers, straight back
    expect(s.used['0:0:1']).toBe(true);
  });
});

describe('turns mode', () => {
  it('active team answers, rotation advances after every clue', () => {
    let s = toBoard(makeSet({ mode: 'turns' }));
    expect(s.turnTeamId).toBe('team_1');
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    expect(s.answeringTeamId).toBe('team_1');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
    expect(s.turnTeamId).toBe('team_2'); // rotated regardless of outcome
  });
});

describe('self mode', () => {
  it('buzz → auto-reveal → single judge', () => {
    let s = toBoard(makeSet({ mode: 'self' }));
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    expect(s.phase).toBe('judging');
    expect(s.revealed).toBe(true); // self mode reveals on buzz
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
  });
});

describe('round + final progression', () => {
  function clearBoard(s) {
    // exhaust all three clues via timeout
    const picks = [['SELECT_TILE'], ['MOVE_CURSOR', 'down'], ['SELECT_TILE'], ['MOVE_CURSOR', 'right'], ['SELECT_TILE']];
    for (const [type, dir] of picks) {
      s = jeopardyReducer(s, { type, dir });
      if (s.phase === 'wager') s = jeopardyReducer(s, { type: 'SET_WAGER', amount: 5 });
      if (s.phase === 'clue') {
        s = jeopardyReducer(s, { type: 'TIMEOUT' });
        s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
      }
    }
    return s;
  }

  it('clearing the last round moves to final; wagers → clue → judging → done', () => {
    let s = clearBoard(toBoard());
    expect(boardDone(s)).toBe(true);
    expect(s.phase).toBe('final-category');
    s = jeopardyReducer(s, { type: 'START_ROUND' }); // advance from final category card
    expect(s.phase).toBe('final-wager');
    s = jeopardyReducer(s, { type: 'SET_FINAL_WAGER', teamId: 'team_1', amount: 100 });
    expect(s.phase).toBe('final-wager'); // still waiting on team_2
    s = jeopardyReducer(s, { type: 'SET_FINAL_WAGER', teamId: 'team_2', amount: 200 });
    expect(s.phase).toBe('final-clue');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    expect(s.phase).toBe('final-judging');
    s = jeopardyReducer(s, { type: 'JUDGE_FINAL', teamId: 'team_1', correct: true });
    expect(s.phase).toBe('final-judging');
    s = jeopardyReducer(s, { type: 'JUDGE_FINAL', teamId: 'team_2', correct: false });
    expect(s.phase).toBe('done');
    expect(s.finalWagers).toEqual({ team_1: 100, team_2: 200 });
  });

  it('a set with no final goes straight to done', () => {
    const s = clearBoard(toBoard(makeSet({ withFinal: false })));
    expect(s.phase).toBe('done');
  });

  it('snapshot/RESTORE round-trips without the set', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    const snap = snapshot(s);
    expect(snap.set).toBeUndefined();
    let restored = initJeopardy(makeSet(), TEAM_IDS);
    restored = jeopardyReducer(restored, { type: 'RESTORE', snapshot: snap });
    expect(restored.phase).toBe('clue');
    expect(restored.active.clue.clue).toBe('a1');
  });

  it('INIT_SET seeds the set and optionally resumes', () => {
    let s = initJeopardy({ rounds: [], final: null }, TEAM_IDS);
    s = jeopardyReducer(s, { type: 'INIT_SET', set: makeSet(), resume: null });
    expect(s.phase).toBe('round-intro');
    expect(s.set.rounds).toHaveLength(1);
  });
});
