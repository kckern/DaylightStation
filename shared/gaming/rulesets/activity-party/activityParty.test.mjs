import { describe, expect, it } from 'vitest';
import { activityPartyRuleModule } from './index.mjs';

const definition = { activities: ['draw', 'charades'], rounds: 1, timer_ms: 30_000, correct_points: 2, challenges: [{ activity: 'draw', prompt: 'Tree' }, { activity: 'charades', prompt: 'Moon' }] };

describe('Activity Party rules', () => {
  it('selects from a word bank in deterministic seeded order when requested', () => {
    const shuffled = { ...definition, challenge_selection: 'seeded' };
    const first = activityPartyRuleModule.createInitialState(shuffled, { seed: 42, participants: [{ id: 'a' }] });
    const replay = activityPartyRuleModule.createInitialState(shuffled, { seed: 42, participants: [{ id: 'a' }] });
    expect(first.challenge_order).toEqual(replay.challenge_order);
    expect(first.challenge).toEqual(replay.challenge);
    expect(first.challenge_order).toHaveLength(definition.challenges.length);
  });

  it('fails closed on invalid mounted challenge content', () => {
    expect(activityPartyRuleModule.validateDefinition({ ...definition, challenges: [{ activity: 'sing', prompt: '' }] })).toMatchObject({ valid: false });
  });
  it('waits for performer readiness before starting the timer and commits outcomes', () => {
    let state = activityPartyRuleModule.createInitialState(definition, { seats: [{ id: 'a' }, { id: 'b' }], setup: { host: { mode: 'human' } } });
    state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, definition, { actorId: 'a', logicalTime: 10 }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, definition, { actorId: 'host', logicalTime: 10 }).state;
    expect(state.deadline).toBe(30_010);
    const outcome = activityPartyRuleModule.handleCommand(state, { type: 'outcome.correct' }, definition, { actorId: 'host', logicalTime: 20 });
    expect(outcome.state.scores.a).toBe(2);
  });
  it('requires configured verification for subjective hostless outcomes', () => {
    let state = activityPartyRuleModule.createInitialState(definition, { seats: [{ id: 'a' }, { id: 'b' }], setup: { host: { mode: 'computer' }, verifier_id: 'b' } });
    state.phase = 'performing';
    const proposed = activityPartyRuleModule.handleCommand(state, { type: 'outcome.correct' }, definition, { actorId: 'a', logicalTime: 1 }).state;
    expect(proposed.phase).toBe('verification');
    expect(activityPartyRuleModule.handleCommand(proposed, { type: 'outcome.confirm', accepted: true }, definition, { actorId: 'b', logicalTime: 2 }).state.scores.a).toBe(2);
  });
  it('advances host hints while drawing persistence stays outside rule state and journal', () => {
    const drawDefinition = { ...definition, challenges: [{ activity: 'draw', prompt: 'Tree', hints: ['green'] }] };
    let state = activityPartyRuleModule.createInitialState(drawDefinition, { seats: [{ id: 'a' }], setup: { host: { mode: 'human' } } });
    state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, drawDefinition, { actorId: 'a' }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, drawDefinition, { actorId: 'host', logicalTime: 10 }).state;
    expect(state).not.toHaveProperty('drawing_checkpoint');
    state = activityPartyRuleModule.handleCommand(state, { type: 'host.reveal' }, drawDefinition, { actorId: 'host' }).state;
    expect(state.revealed_hints).toBe(1);
    const finished = activityPartyRuleModule.handleCommand(state, { type: 'challenge.finish' }, drawDefinition, { actorId: 'a' });
    expect(finished.events.map((event) => event.type)).toContain('challenge.finished');
  });
  it('fails closed for performer, host, and verifier authority', () => {
    let state = activityPartyRuleModule.createInitialState(definition, {
      seats: [{ id: 'team-a', members: [{ id: 'a' }] }, { id: 'team-b', members: [{ id: 'b' }] }],
      setup: { host: { mode: 'computer' }, verifier_id: 'b' },
    });
    expect(activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, definition, { actorId: 'b' }).error.code).toBe('authorization_denied');
    state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, definition, { actorId: 'a' }).state;
    expect(activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, definition, { actorId: 'a', logicalTime: 1 }).error.code).toBe('authorization_denied');
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, definition, { actorId: 'host', logicalTime: 1 }).state;
    expect(activityPartyRuleModule.handleCommand(state, { type: 'host.reveal' }, definition, { actorId: 'a' }).error.code).toBe('authorization_denied');
    state = activityPartyRuleModule.handleCommand(state, { type: 'outcome.correct' }, definition, { actorId: 'a' }).state;
    expect(activityPartyRuleModule.handleCommand(state, { type: 'outcome.confirm', accepted: true }, definition, { actorId: 'a' }).error.code).toBe('authorization_denied');
    expect(activityPartyRuleModule.handleCommand(state, { type: 'outcome.confirm', accepted: true }, definition, { actorId: 'b' }).state.phase).toBe('challenge-complete');
  });
  it('rejects a subjective hostless decision without a verifier', () => {
    const state = {
      ...activityPartyRuleModule.createInitialState(definition, { seats: [{ id: 'a' }], setup: { host: { mode: 'ai-assisted' } } }),
      phase: 'adjudication',
    };
    expect(activityPartyRuleModule.handleCommand(state, { type: 'outcome.correct' }, definition, { actorId: 'a' }).error.code).toBe('verifier_required');
  });

  it('enforces timer deadlines and configured scoring in authoritative rules', () => {
    let state = activityPartyRuleModule.createInitialState(definition, { seats: [{ id: 'a' }], setup: { host: { mode: 'human' } } });
    state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, definition, { actorId: 'a' }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, definition, { actorId: 'host', logicalTime: 100 }).state;
    expect(activityPartyRuleModule.handleCommand(state, { type: 'timer.expire' }, definition, { actorId: 'host', logicalTime: 30_099 })).toMatchObject({ error: { code: 'illegal_command' } });
    state = activityPartyRuleModule.handleCommand(state, { type: 'timer.expire' }, definition, { actorId: 'host', logicalTime: 30_100 }).state;
    const committed = activityPartyRuleModule.handleCommand(state, { type: 'outcome.correct', points: 999 }, definition, { actorId: 'host' });
    expect(committed.state.scores.a).toBe(definition.correct_points);
  });

  it('rejects unrelated hostless outcome proposals and verifier-only passes', () => {
    const setup = { host: { mode: 'computer' }, verifier_id: 'b' };
    const seats = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const state = { ...activityPartyRuleModule.createInitialState(definition, { seats, setup }), phase: 'adjudication' };
    expect(activityPartyRuleModule.handleCommand(state, { type: 'outcome.correct' }, definition, { actorId: 'c' })).toMatchObject({ error: { code: 'authorization_denied' } });
    expect(activityPartyRuleModule.handleCommand(state, { type: 'outcome.pass' }, definition, { actorId: 'b' })).toMatchObject({ error: { code: 'authorization_denied' } });
  });

  it('rotates every performer through every configured round and then completes', () => {
    const twoRounds = { ...definition, rounds: 2 };
    let state = activityPartyRuleModule.createInitialState(twoRounds, { seats: [{ id: 'a' }, { id: 'b' }], setup: { host: { mode: 'human' } } });
    for (let index = 0; index < 4; index += 1) {
      expect(state.performer_id).toBe(index % 2 === 0 ? 'a' : 'b');
      expect(state.round).toBe(Math.floor(index / 2) + 1);
      state.phase = 'challenge-complete';
      state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.next' }, twoRounds, { actorId: 'host' }).state;
    }
    expect(state).toMatchObject({ status: 'complete', phase: 'complete', challenge_index: 4 });
  });
});
