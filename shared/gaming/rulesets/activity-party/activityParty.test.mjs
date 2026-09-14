import { describe, expect, it } from 'vitest';
import { activityPartyRuleModule } from './index.mjs';

const definition = { activities: ['draw', 'charades'], rounds: 1, timer_ms: 30_000, correct_points: 2, challenges: [{ activity: 'draw', prompt: 'Tree' }, { activity: 'charades', prompt: 'Moon' }] };

const casualDefinition = {
  title: 'FHE Charades', activities: ['charades'], rounds: 3, timer_ms: 60_000,
  competition: false, turn_selection: 'seeded-rounds', clues_per_turn: 1,
  presentation: { image_participants: ['a', 'b'] },
  guessing_music: { source: 'plex:charades-music', volume: 0.4 },
  challenges: [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `image-${index}`, activity: 'charades', prompt: `Image ${index}`, decoder: { image: `/image-${index}.svg` } })),
    ...Array.from({ length: 12 }, (_, index) => ({ id: `text-${index}`, activity: 'charades', prompt: `Text ${index}` })),
  ],
};

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
    expect(activityPartyRuleModule.project(proposed, definition, { role: 'participant', participant_id: 'b' }).state.challenge.prompt).toBe('Tree');
    expect(activityPartyRuleModule.project(proposed, definition, { role: 'participant', participant_id: 'observer' }).state.challenge).toEqual({ activity: 'draw' });
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

  it('executes all casual turns using seeded rounds and presentation-specific clue pools', () => {
    const seats = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
    let state = activityPartyRuleModule.createInitialState(casualDefinition, { seed: 42, seats, setup: { host: { mode: 'human' } } });
    const replay = activityPartyRuleModule.createInitialState(casualDefinition, { seed: 42, seats, setup: { host: { mode: 'human' } } });
    const different = activityPartyRuleModule.createInitialState(casualDefinition, { seed: 43, seats, setup: { host: { mode: 'human' } } });
    expect(state.turn_order).toEqual(replay.turn_order);
    expect(state.challenge_order).toEqual(replay.challenge_order);
    expect(state.turn_order).not.toEqual(different.turn_order);

    const observedTurns = [];
    const imageClues = [];
    let logicalTime = 1_000;
    while (state.phase !== 'complete') {
      observedTurns.push(state.performer_id);
      if (state.clue_presentation === 'image') imageClues.push(state.challenge.id);
      else expect(state.challenge.decoder?.image).toBeUndefined();
      state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, casualDefinition, { actorId: state.performer_id, logicalTime }).state;
      state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, casualDefinition, { actorId: 'host', logicalTime }).state;
      expect(state.deadline).toBe(logicalTime + 60_000);
      state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.finish' }, casualDefinition, { actorId: state.performer_id, logicalTime: logicalTime + 1_000 }).state;
      expect(state).toMatchObject({ phase: 'challenge-complete', scores: {} });
      state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.next' }, casualDefinition, { actorId: 'host', logicalTime: logicalTime + 2_000 }).state;
      logicalTime += 10_000;
    }

    expect(observedTurns).toHaveLength(18);
    for (let round = 0; round < 3; round += 1) {
      const roundTurns = observedTurns.slice(round * 6, (round + 1) * 6);
      expect(roundTurns.sort()).toEqual(seats.map((seat) => seat.id).sort());
    }
    expect(new Set(imageClues).size).toBe(6);
    expect(state.scores).toEqual({});
    expect(state.phase).toBe('complete');
  });

  it('rejects duplicate commands and early casual expiry without advancing state', () => {
    const seats = [{ id: 'a' }, { id: 'b' }];
    let state = activityPartyRuleModule.createInitialState(casualDefinition, { seed: 7, seats });
    state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, casualDefinition, { actorId: state.performer_id, logicalTime: 100 }).state;
    expect(activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, casualDefinition, { actorId: state.performer_id, logicalTime: 100 })).toMatchObject({ error: { code: 'illegal_command' } });
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, casualDefinition, { actorId: 'host', logicalTime: 100 }).state;
    expect(activityPartyRuleModule.handleCommand(state, { type: 'timer.expire' }, casualDefinition, { actorId: 'host', logicalTime: 60_099 })).toMatchObject({ error: { code: 'illegal_command' } });
    state = activityPartyRuleModule.handleCommand(state, { type: 'timer.expire' }, casualDefinition, { actorId: 'host', logicalTime: 60_100 }).state;
    expect(state).toMatchObject({ phase: 'challenge-complete', scores: {} });
    expect(activityPartyRuleModule.handleCommand(state, { type: 'timer.expire' }, casualDefinition, { actorId: 'host', logicalTime: 60_100 })).toMatchObject({ error: { code: 'illegal_command' } });
  });

  it('lets the host rewind an accidentally started clue without losing the turn', () => {
    let state = activityPartyRuleModule.createInitialState(casualDefinition, { seed: 7, seats: [{ id: 'a' }, { id: 'b' }] });
    state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, casualDefinition, { actorId: state.performer_id, logicalTime: 100 }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, casualDefinition, { actorId: 'host', logicalTime: 200 }).state;
    const rewound = activityPartyRuleModule.handleCommand(state, { type: 'challenge.rewind' }, casualDefinition, { actorId: 'host', logicalTime: 300 });
    expect(rewound.state).toMatchObject({ phase: 'challenge-ready', deadline: null, challenge_index: 0, remaining_ms: 60_000 });
    expect(rewound.events).toEqual([{ type: 'challenge.rewound' }]);
    expect(activityPartyRuleModule.handleCommand(state, { type: 'challenge.rewind' }, casualDefinition, { actorId: 'a', logicalTime: 300 }))
      .toMatchObject({ error: { code: 'authorization_denied' } });
  });

  it('pauses the remaining per-turn budget while reading additional clues', () => {
    const multiClue = { ...casualDefinition, rounds: 1, clues_per_turn: 2, presentation: { image_participants: [] } };
    let state = activityPartyRuleModule.createInitialState(multiClue, { seed: 5, seats: [{ id: 'c' }, { id: 'd' }] });
    state = activityPartyRuleModule.handleCommand(state, { type: 'performer.ready' }, multiClue, { actorId: state.performer_id, logicalTime: 1_000 }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, multiClue, { actorId: 'host', logicalTime: 1_000 }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.finish' }, multiClue, { actorId: state.performer_id, logicalTime: 11_000 }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.next' }, multiClue, { actorId: 'host', logicalTime: 20_000 }).state;
    expect(state).toMatchObject({ phase: 'challenge-ready', challenge_index: 0, clue_index: 1, deadline: null });
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.start' }, multiClue, { actorId: 'host', logicalTime: 40_000 }).state;
    expect(state.deadline).toBe(90_000);
    state = activityPartyRuleModule.handleCommand(state, { type: 'timer.expire' }, multiClue, { actorId: 'host', logicalTime: 90_000 }).state;
    state = activityPartyRuleModule.handleCommand(state, { type: 'challenge.next' }, multiClue, { actorId: 'host', logicalTime: 90_001 }).state;
    expect(state).toMatchObject({ phase: 'performer-ready', challenge_index: 1, clue_index: 0 });
  });

  it('projects casual presentation and music settings with stable names', () => {
    const state = activityPartyRuleModule.createInitialState(casualDefinition, { seed: 2, seats: [{ id: 'a' }, { id: 'c' }] });
    const projected = activityPartyRuleModule.project(state, casualDefinition, { role: 'host' });
    expect(projected.definition).toMatchObject({
      competition: false, turn_selection: 'seeded-rounds', clues_per_turn: 1,
      presentation: { image_participants: ['a', 'b'] },
      guessing_music: { source: 'plex:charades-music', volume: 0.4 },
    });
    expect(projected.state).toMatchObject({ competition: false, clue_index: 0, clue_presentation: 'image' });
  });

  it('rejects invalid casual settings and missing eligible challenge pools', () => {
    expect(activityPartyRuleModule.validateDefinition({ ...casualDefinition, turn_selection: 'random' })).toMatchObject({ valid: false });
    expect(activityPartyRuleModule.validateDefinition({ ...casualDefinition, clues_per_turn: 0 })).toMatchObject({ valid: false });
    expect(activityPartyRuleModule.validateDefinition({ ...casualDefinition, guessing_music: { source: '', volume: 2 } })).toMatchObject({ valid: false });
    expect(activityPartyRuleModule.validateDefinition({ ...casualDefinition, guessing_music: { source: 'plex:music', volume: 0.3, order: 'shuffle', repeat: 'sometimes', memory: 'session' } })).toMatchObject({ valid: false });
    expect(() => activityPartyRuleModule.createInitialState({
      ...casualDefinition,
      challenges: casualDefinition.challenges.filter((challenge) => !challenge.decoder?.image),
    }, { seed: 2, seats: [{ id: 'a' }] })).toThrow('image challenge pool');
  });
});
