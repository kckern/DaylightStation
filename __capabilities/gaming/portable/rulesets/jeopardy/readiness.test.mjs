import { describe, it, expect } from 'vitest';
import { jeopardyRuleModule as rules } from './index.mjs';
const definition = { rounds: [{ mode: 'hosted', categories: [{ clues: [{ value: 100, clue: 'Secret prompt', answer: 'Secret answer', little_kids: true }, { value: 200, clue: 'Normal', answer: 'Normal answer' }, { value: 100, clue: 'Kids two', answer: 'Kids answer', little_kids: true }] }] }] };
const seats = [{ id: 'red' }, { id: 'blue' }];
const initial = () => rules.createInitialState(definition, { seats });
const command = (state, action, actorId = 'host', logicalTime = 1000) => rules.handleCommand(state, action, definition, { actorId, logicalTime });
function setup(state = initial()) {
  state = command(state, { type: 'BUZZER_SETUP', epoch: 'tv-one' }).state;
  for (const [teamId, slot] of [['red', 'gamepad:0:Pad'], ['blue', 'gamepad:1:Pad']]) {
    state = command(state, { type: 'BUZZER_REPORT', epoch: 'tv-one', generation: 0, teamId, slot, kind: 'assign' }).state;
    state = command(state, { type: 'BUZZER_REPORT', epoch: 'tv-one', generation: 0, teamId, slot, kind: 'test' }).state;
  }
  return state;
}
describe('authoritative buzzer readiness', () => {
  it('fails safe for new and restored competitive sessions and forbids forged participant reports', () => {
    expect(command(initial(), { type: 'START_ROUND' }).error?.code).toBe('buzzers_not_ready');
    const restored = initial(); delete restored.buzzerSetup;
    expect(command(restored, { type: 'START_ROUND' }).error?.code).toBe('buzzers_not_ready');
    expect(command(initial(), { type: 'BUZZER_SETUP', epoch: 'forged' }, 'red').error?.code).toBe('authorization_denied');
  });
  it('requires a separate test for each team, rejects duplicate ownership and stale reassignment reports', () => {
    let state = command(initial(), { type: 'BUZZER_SETUP', epoch: 'tv-one' }).state;
    state = command(state, { type: 'BUZZER_REPORT', epoch: 'tv-one', generation: 0, teamId: 'red', slot: 'gamepad:0:Pad', kind: 'assign' }).state;
    expect(command(state, { type: 'START_ROUND' }).error?.code).toBe('buzzers_not_ready');
    expect(command(state, { type: 'BUZZER_REPORT', epoch: 'tv-one', generation: 0, teamId: 'blue', slot: 'gamepad:0:Pad', kind: 'assign' }).error?.code).toBe('invalid_buzzer_report');
    state = setup();
    expect(command(state, { type: 'START_ROUND' }).state.phase).toBe('board');
    state = command(state, { type: 'BUZZER_REASSIGN', teamId: 'red' }).state;
    expect(command(state, { type: 'BUZZER_REPORT', epoch: 'tv-one', generation: 0, teamId: 'red', slot: 'gamepad:0:Pad', kind: 'test' }).error?.code).toBe('invalid_buzzer_report');
    expect(command(state, { type: 'START_ROUND' }).error?.code).toBe('buzzers_not_ready');
  });
  it('invalidates tests on disconnect, TV refresh and expired presence', () => {
    const ready = setup();
    const disconnected = command(ready, { type: 'BUZZER_REPORT', epoch: 'tv-one', generation: 0, teamId: 'red', slot: 'gamepad:0:Pad', kind: 'disconnect' }).state;
    expect(command(disconnected, { type: 'START_ROUND' }).error?.code).toBe('buzzers_not_ready');
    const refreshed = command(ready, { type: 'BUZZER_SETUP', epoch: 'tv-two' }).state;
    expect(command(refreshed, { type: 'START_ROUND' }).error?.code).toBe('buzzers_not_ready');
    expect(command(refreshed, { type: 'BUZZER_REPORT', epoch: 'tv-one', generation: 0, teamId: 'red', slot: 'gamepad:0:Pad', kind: 'test' }).error?.code).toBe('invalid_buzzer_report');
    expect(command(ready, { type: 'START_ROUND' }, 'host', 30000).error?.code).toBe('buzzers_not_ready');
  });
  it('preserves explicit noncompetitive turns mode', () => {
    const pack = structuredClone(definition); pack.rounds[0].mode = 'turns';
    const state = rules.createInitialState(pack, { seats });
    expect(command(state, { type: 'START_ROUND' }).state.phase).toBe('board');
  });
});
describe('fixed little-kids ownership', () => {
  it('balances canonical assignments, preserves safe board metadata, grants only the owner and never steals', () => {
    let state = setup();
    const clues = state.set.rounds[0].categories[0].clues;
    expect(clues.map(c => c.assigned_team_id)).toEqual(['red', undefined, 'blue']);
    const publicState = rules.project(state, definition, { role: 'participant' }).state;
    expect(publicState.set.rounds[0].categories[0].clues[0]).toEqual({ value: 100, little_kids: true, assigned_team_id: 'red' });
    expect(JSON.stringify(publicState)).not.toContain('Secret');
    expect(JSON.stringify(publicState)).not.toContain('gamepad:');
    state = command(state, { type: 'START_ROUND' }).state;
    state = command(state, { type: 'SELECT_AT', cat: 0, row: 0 }).state;
    expect(state.answeringTeamId).toBe('red');
    expect(command(state, { type: 'BUZZ', teamId: 'blue' }).error?.code).toBe('illegal_command');
    state = command(state, { type: 'REVEAL' }).state;
    state = command(state, { type: 'JUDGE', correct: false }).state;
    expect(state.phase).toBe('board');
    expect(state.used['0:0:0']).toBe(true);
    state = command(state, { type: 'SELECT_AT', cat: 0, row: 1 }).state;
    expect(state.answeringTeamId).toBe(null);
    expect(command(state, { type: 'BUZZ', teamId: 'blue' }).state.answeringTeamId).toBe('blue');
  });
});

it('uses authority wall time so a forged command timestamp cannot revive expired readiness', () => {
  const ready = setup();
  const result = rules.handleCommand(ready, { type: 'START_ROUND' }, definition, { actorId: 'host', logicalTime: 1000, recordedAt: '1970-01-01T00:00:30.000Z' });
  expect(result.error?.code).toBe('buzzers_not_ready');
});

it('migrates little-kids ownership in restored boards without changing scores or used tiles', () => {
  const restored = initial();
  for (const clue of restored.set.rounds[0].categories[0].clues) delete clue.assigned_team_id;
  restored.scores = { red: 500, blue: 200 }; restored.used = { '0:0:1': true }; restored.phase = 'board';
  const selected = command(restored, { type: 'SELECT_AT', cat: 0, row: 2 }).state;
  expect(selected.answeringTeamId).toBe('blue');
  expect(selected.scores).toEqual({ red: 500, blue: 200 });
  expect(selected.used).toEqual({ '0:0:1': true });
  expect(rules.project(restored, definition, { role: 'participant' }).state.set.rounds[0].categories[0].clues[2].assigned_team_id).toBe('blue');
});

it('explicitly migrates only an unstarted pinned turns session without replacing its teams or scores', () => {
  const pack = structuredClone(definition); pack.rounds[0].mode = 'turns';
  const old = rules.createInitialState(pack, { seats });
  const migrated = command(old, { type: 'CONFIGURE_COMPETITIVE' }).state;
  expect(migrated.set.rounds[0].mode).toBe('hosted');
  expect(migrated.teamIds).toEqual(['red', 'blue']);
  expect(migrated.scores).toEqual({ red: 0, blue: 0 });
  expect(migrated.set.rounds[0].categories[0].clues[2].assigned_team_id).toBe('blue');
  expect(command(migrated, { type: 'START_ROUND' }).error?.code).toBe('buzzers_not_ready');
  expect(command(old, { type: 'CONFIGURE_COMPETITIVE' }, 'red').error?.code).toBe('authorization_denied');
  for (const changed of [{ phase: 'board' }, { scores: { red: 100, blue: 0 } }, { used: { '0:0:0': true } }, { roundIndex: 1 }]) {
    expect(command({ ...old, ...changed }, { type: 'CONFIGURE_COMPETITIVE' }).error?.code).toBe('illegal_command');
  }
});

it('does not require buzzers for the final category handoff, which never races for buzzes', () => {
  const state = { ...initial(), phase: 'final-category' };
  expect(command(state, { type: 'START_ROUND' }).state?.phase).toBe('final-wager');
});

it('keeps setup and presence events stable through the durable JSON journal boundary', () => {
  let state = initial();
  for (const action of [{ type: 'BUZZER_SETUP', epoch: 'durable' }, { type: 'BUZZER_PRESENCE', epoch: 'durable' }]) {
    const result = command(state, action);
    expect(JSON.parse(JSON.stringify(result.events))).toStrictEqual(result.events);
    state = result.state;
  }
});
