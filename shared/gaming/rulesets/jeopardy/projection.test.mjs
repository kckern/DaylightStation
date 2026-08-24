import { describe, expect, it } from 'vitest';
import { jeopardyRuleModule } from './index.mjs';

const definition = {
  title: 'Fixture',
  rounds: [{ name: 'Round', mode: 'hosted', multiplier: 1, penalize_wrong: true, categories: [{ name: 'Category', clues: [{ value: 100, clue: 'Question?', answer: 'Answer!', daily_double: true }] }] }],
  final: { category: 'Final', clue: 'Final question?', answer: 'Final answer!' },
};

describe('Jeopardy viewer projections', () => {
  it('keeps unopened clues, daily doubles, answers, and final text secret from participants', () => {
    const state = jeopardyRuleModule.createInitialState(definition, { seats: [{ id: 'team' }] });
    const participant = jeopardyRuleModule.project(state, definition, { role: 'participant', participant_id: 'team' });
    expect(participant.state.set.rounds[0].categories[0].clues[0]).toEqual({ value: 100 });
    expect(participant.state.set.final).toEqual({ category: 'Final' });
    expect(JSON.stringify(participant)).not.toContain('Answer!');
  });

  it('reveals only the selected clue prompt until the answer is committed for display', () => {
    let state = jeopardyRuleModule.createInitialState(definition, { seats: [{ id: 'team' }] });
    state = { ...state, phase: 'board' };
    state = jeopardyRuleModule.handleCommand(state, { type: 'jeopardy.select.tile' }, definition, { actorId: 'host' }).state;
    const hidden = jeopardyRuleModule.project(state, definition, { role: 'participant', participant_id: 'team' });
    expect(hidden.state.active.clue).toMatchObject({ clue: 'Question?', value: 100 });
    expect(hidden.state.active.clue).not.toHaveProperty('answer');
    state = { ...state, revealed: true };
    expect(jeopardyRuleModule.project(state, definition, { role: 'participant' }).state.active.clue.answer).toBe('Answer!');
    expect(jeopardyRuleModule.project(state, definition, { role: 'host' }).state.set.final.answer).toBe('Final answer!');
  });

  it('keeps other teams final wagers secret until judging', () => {
    const state = {
      ...jeopardyRuleModule.createInitialState(definition, { seats: [{ id: 'red', members: [{ id: 'r' }] }, { id: 'blue', members: [{ id: 'b' }] }] }),
      phase: 'final-wager', finalWagers: { red: 100, blue: 200 },
    };
    expect(jeopardyRuleModule.project(state, definition, { role: 'participant', participant_id: 'r' }).state.finalWagers).toEqual({ red: 100, blue: null });
    expect(jeopardyRuleModule.project({ ...state, phase: 'final-judging' }, definition, { role: 'participant', participant_id: 'r' }).state.finalWagers).toEqual({ red: 100, blue: 200 });
  });
});
