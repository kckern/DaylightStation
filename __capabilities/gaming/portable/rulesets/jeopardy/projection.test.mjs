import { describe, expect, it } from 'vitest';
import { jeopardyRuleModule } from "./index.mjs";

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

it('hides_future_references and preserves selected references before reveal', () => {
  const pack = structuredClone(definition);
  pack.rounds[0].categories[0].clues[0].scripture_reference = 'Jeremiah 2:13';
  pack.final.scripture_reference = 'Jonah 1:17';
  let state = { ...jeopardyRuleModule.createInitialState(pack, { seats: [{ id: 'team' }] }), phase: 'board' };
  const project = () => jeopardyRuleModule.project(state, pack, { role: 'participant' }).state;
  expect(project().set.rounds[0].categories[0].clues[0]).toEqual({ value: 100 });
  state = jeopardyRuleModule.handleCommand(state, { type: 'SELECT_TILE' }, pack, { actorId: 'host' }).state;
  expect(project().active.clue.scripture_reference).toBe('Jeremiah 2:13');
  expect(project().active.clue).not.toHaveProperty('answer');
  state = { ...state, phase: 'final-wager' };
  expect(project().set.final).toEqual({ category: 'Final' });
  state = { ...state, phase: 'final-clue' };
  expect(project().set.final).toMatchObject({ clue: 'Final question?', scripture_reference: 'Jonah 1:17' });
  expect(project().set.final).not.toHaveProperty('answer');
});

describe('Jeopardy learn notes', () => {
  const learn = { ref: 'Lam 3:23', text: 'His great love is new every morning.' };
  const withLearn = {
    ...definition,
    rounds: [{ ...definition.rounds[0], categories: [{ name: 'Category', clues: [{ ...definition.rounds[0].categories[0].clues[0], daily_double: false, learn }] }] }],
    final: { ...definition.final, learn },
  };

  it('rejects a malformed learn note', () => {
    const bad = { ...withLearn, final: { ...withLearn.final, learn: { ref: 'Lam 3:23' } } };
    expect(jeopardyRuleModule.validateDefinition(bad)).toMatchObject({ valid: false, errors: expect.arrayContaining(['final.learn.text is required']) });
    expect(jeopardyRuleModule.validateDefinition(withLearn).valid).toBe(true);
  });

  it('shows participants the learn note only with the answer, and only the host opens it', () => {
    let state = { ...jeopardyRuleModule.createInitialState(withLearn, { seats: [{ id: 'team' }] }), phase: 'board' };
    state = jeopardyRuleModule.handleCommand(state, { type: 'jeopardy.select.tile' }, withLearn, { actorId: 'host' }).state;
    expect(JSON.stringify(jeopardyRuleModule.project(state, withLearn, { role: 'participant' }))).not.toContain('new every morning');
    state = jeopardyRuleModule.handleCommand(state, { type: 'jeopardy.timeout' }, withLearn, { actorId: 'host' }).state;
    expect(jeopardyRuleModule.project(state, withLearn, { role: 'participant' }).state.active.clue.learn).toEqual(learn);
    expect(jeopardyRuleModule.handleCommand(state, { type: 'jeopardy.show.learn' }, withLearn, { actorId: 'team' }).error.code).toBe('authorization_denied');
    state = jeopardyRuleModule.handleCommand(state, { type: 'jeopardy.show.learn' }, withLearn, { actorId: 'host' }).state;
    expect(state.learning).toBe(true);
  });
});
