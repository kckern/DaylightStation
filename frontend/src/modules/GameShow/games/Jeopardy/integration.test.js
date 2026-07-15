// Plays a full 2-clue game through the reducers exactly as Jeopardy.jsx does,
// asserting the score bookkeeping contract between jeopardyReducer and scoreReducer.
import { describe, it, expect } from 'vitest';
import { initJeopardy, jeopardyReducer, scoreDelta } from './jeopardyReducer.js';
import { scoreReducer, initScores } from '../../shell/scoreboard/scoreReducer.js';

const TEAMS = [{ id: 'team_1' }, { id: 'team_2' }];
const SET = {
  id: 's', title: 'S', description: '',
  rounds: [{
    name: 'R1', mode: 'hosted', multiplier: 2, timer_seconds: null, penalize_wrong: true,
    categories: [{ name: 'C', clues: [
      { value: 100, clue: 'q1', answer: 'a1', media: null, daily_double: false },
      { value: 200, clue: 'q2', answer: 'a2', media: null, daily_double: false },
    ] }],
  }],
  final: { category: 'F', clue: 'fq', answer: 'fa', media: null },
};

function judge(game, scores, correct) {
  const d = scoreDelta(game, correct);
  const nextScores = d && d.delta !== 0
    ? scoreReducer(scores, { type: d.delta > 0 ? 'AWARD' : 'DEDUCT', teamId: d.teamId, points: Math.abs(d.delta) })
    : scores;
  return [jeopardyReducer(game, { type: 'JUDGE', correct }), nextScores];
}

it('full hosted game: wrong then right, final wagers settle correctly', () => {
  let game = jeopardyReducer(initJeopardy(SET, TEAMS.map((t) => t.id)), { type: 'START_ROUND' });
  let scores = initScores(TEAMS);

  // clue 1 (value 100 × mult 2 = 200): team_1 wrong (−200), team_2 right (+200)
  game = jeopardyReducer(game, { type: 'SELECT_TILE' });
  game = jeopardyReducer(game, { type: 'BUZZ', teamId: 'team_1' });
  [game, scores] = judge(game, scores, false);
  game = jeopardyReducer(game, { type: 'BUZZ', teamId: 'team_2' });
  [game, scores] = judge(game, scores, true);
  expect(scores).toEqual({ team_1: -200, team_2: 200 });

  // clue 2 (400): team_2 right again
  game = jeopardyReducer(game, { type: 'MOVE_CURSOR', dir: 'down' });
  game = jeopardyReducer(game, { type: 'SELECT_TILE' });
  game = jeopardyReducer(game, { type: 'BUZZ', teamId: 'team_2' });
  [game, scores] = judge(game, scores, true);
  expect(scores.team_2).toBe(600);
  expect(game.phase).toBe('final-category');

  // final: both wager, team_1 right, team_2 wrong
  game = jeopardyReducer(game, { type: 'START_ROUND' });
  game = jeopardyReducer(game, { type: 'SET_FINAL_WAGER', teamId: 'team_1', amount: 5 });
  game = jeopardyReducer(game, { type: 'SET_FINAL_WAGER', teamId: 'team_2', amount: 600 });
  game = jeopardyReducer(game, { type: 'REVEAL' });
  scores = scoreReducer(scores, { type: 'AWARD', teamId: 'team_1', points: 5 });
  game = jeopardyReducer(game, { type: 'JUDGE_FINAL', teamId: 'team_1', correct: true });
  scores = scoreReducer(scores, { type: 'DEDUCT', teamId: 'team_2', points: 600 });
  game = jeopardyReducer(game, { type: 'JUDGE_FINAL', teamId: 'team_2', correct: false });
  expect(game.phase).toBe('done');
  expect(scores).toEqual({ team_1: -195, team_2: 0 });
});
