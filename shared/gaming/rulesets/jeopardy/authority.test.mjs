import { describe, expect, it } from 'vitest';
import { jeopardyRuleModule } from './index.mjs';

const definition = {
  title: 'Fixture',
  rounds: [{ name: 'Round', mode: 'hosted', multiplier: 1, categories: [{ name: 'Category', clues: [{ value: 100, clue: 'Prompt', answer: 'Answer' }] }] }],
  final: { category: 'Final', clue: 'Final prompt', answer: 'Final answer' },
};

describe('Jeopardy semantic authority', () => {
  it('reserves board and judgment commands for the host', () => {
    const state = jeopardyRuleModule.createInitialState(definition, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }, { id: 'blue', members: [{ id: 'blue-player' }] }] });
    expect(jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, definition, { actorId: 'red-player' }).error.code).toBe('authorization_denied');
    expect(jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, definition, { actorId: 'host' }).state.phase).toBe('board');
  });

  it('allows a participant to act only for their bound team', () => {
    let state = jeopardyRuleModule.createInitialState(definition, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }, { id: 'blue', members: [{ id: 'blue-player' }] }] });
    state = jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, definition, { actorId: 'host' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'SELECT_TILE' }, definition, { actorId: 'host' }).state;
    expect(jeopardyRuleModule.handleCommand(state, { type: 'BUZZ', teamId: 'blue' }, definition, { actorId: 'red-player' }).error.code).toBe('authorization_denied');
    expect(jeopardyRuleModule.handleCommand(state, { type: 'BUZZ', teamId: 'red' }, definition, { actorId: 'red-player' }).state.answeringTeamId).toBe('red');
  });

  it('validates wagers in the authoritative ruleset', () => {
    const state = {
      ...jeopardyRuleModule.createInitialState(definition, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }] }),
      phase: 'wager', answeringTeamId: 'red', scores: { red: 50 },
    };
    expect(jeopardyRuleModule.handleCommand(state, { type: 'SET_WAGER', amount: 1000 }, definition, { actorId: 'red-player' }).error.code).toBe('invalid_wager');
    expect(jeopardyRuleModule.handleCommand(state, { type: 'SET_WAGER', amount: 100 }, definition, { actorId: 'red-player' }).state.wager).toBe(100);
  });

  it('normalizes an omitted round multiplier before values reach state or scoring', () => {
    const withoutMultiplier = {
      ...definition,
      rounds: definition.rounds.map(({ multiplier: _multiplier, ...round }) => round),
    };
    let state = jeopardyRuleModule.createInitialState(withoutMultiplier, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }] });
    expect(state.set.rounds[0].multiplier).toBe(1);
    state = jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, withoutMultiplier, { actorId: 'host' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'SELECT_TILE' }, withoutMultiplier, { actorId: 'host' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'BUZZ', teamId: 'red' }, withoutMultiplier, { actorId: 'red-player' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'JUDGE', correct: true }, withoutMultiplier, { actorId: 'host' }).state;
    expect(state.scores.red).toBe(100);
  });
});
