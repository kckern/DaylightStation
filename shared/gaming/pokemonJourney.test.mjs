import fs from 'node:fs';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { createInitialState, deriveInteraction, transition } from './reducer.mjs';
import { computePokemonJourneyScore } from './pokemonJourney.mjs';

const definition = YAML.parse(fs.readFileSync(new URL('./definitions/card-game.yml', import.meta.url), 'utf8'));

function command(type, payload = {}, id = type) {
  return { command_id: id, session_revision: 0, type, payload };
}

function resolveMove(state, moveId, result, prefix = `${moveId}-${state.practice_attempts.length}`) {
  const move = state.zones.hand.find((candidate) => candidate.definition_id === moveId);
  let outcome = transition(state, command('choose_action', { card_instance_id: move.instance_id }, `${prefix}-choose`), definition);
  const challengeId = outcome.state.pending_action.id;
  outcome = transition(outcome.state, command('prepare_challenge', {
    challenge_id: challengeId,
    prepared: { challenge_id: challengeId, grading_policy_version: 'grading-v1' },
  }, `${prefix}-prepare`), definition);
  outcome = transition(outcome.state, command('start_challenge', { challenge_id: challengeId }, `${prefix}-start`), definition);
  return transition(outcome.state, command('submit_challenge_result', {
    challenge_id: challengeId,
    result: {
      status: 'completed', score: result.score,
      metrics: { firstTry: result.firstTry ?? true },
      provider_version: 'provider-v1', attempt_id: `${prefix}-attempt`,
    },
  }, `${prefix}-result`), definition);
}

describe('Pokémon piano practice journey', () => {
  it('starts every partner with three skill families and unlocks rhythm after battle one', () => {
    for (const partner of definition.journey.partners) {
      const state = createInitialState(definition, {
        seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: partner.id },
      });
      const kinds = state.zones.hand.map((instance) => definition.cards[instance.definition_id].challenge.kind);
      expect(kinds).toEqual(['scale', 'chord', 'arpeggio']);
      expect(deriveInteraction(state, definition, 'kid-1').legal_commands).toHaveLength(3);
      expect(state.route_plan).toHaveLength(5);
      expect(new Set(state.route_plan.map((opponent) => opponent.id)).size).toBe(5);
    }
  });

  it.each([
    [0.95, 'bullseye', 55],
    [0.80, 'direct-hit', 44],
    [0.60, 'partial-hit', 29],
    [0.40, 'miss', 11],
  ])('maps a piano score of %s to %s instead of type effectiveness', (score, expectedHit, expectedDamage) => {
    const state = createInitialState(definition, {
      seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'bulbasaur' },
    });
    const result = resolveMove(state, 'vine-whip', { score });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'challenge_resolved', score, outcome: expectedHit,
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'damage_dealt', target: 'enemy', amount: expectedDamage,
    }));
  });

  it('turns aborts and timeouts into misses, while provider errors refund and unrank the run', () => {
    const initial = createInitialState(definition, {
      seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'charmander' },
    });
    const move = initial.zones.hand.find((candidate) => candidate.definition_id === 'ember');
    let outcome = transition(initial, command('choose_action', { card_instance_id: move.instance_id }, 'choose'), definition);
    const challengeId = outcome.state.pending_action.id;
    outcome = transition(outcome.state, command('prepare_challenge', {
      challenge_id: challengeId, prepared: { grading_policy_version: 'grading-v1' },
    }, 'prepare'), definition);
    outcome = transition(outcome.state, command('start_challenge', { challenge_id: challengeId }, 'start'), definition);
    const timedOut = transition(outcome.state, command('submit_challenge_result', {
      challenge_id: challengeId,
      result: { status: 'timeout', score: null, metrics: { reason: 'challenge_timeout' }, provider_version: 'provider-v1' },
    }, 'timeout'), definition);
    expect(timedOut.state.practice_attempts.at(-1)).toMatchObject({ status: 'timeout', score: 0 });
    expect(timedOut.events).toContainEqual(expect.objectContaining({ type: 'challenge_resolved', outcome: 'miss' }));

    outcome = transition(timedOut.state, command('choose_action', { card_instance_id: move.instance_id }, 'error-choose'), definition);
    const errorChallenge = outcome.state.pending_action.id;
    outcome = transition(outcome.state, command('prepare_challenge', {
      challenge_id: errorChallenge, prepared: { grading_policy_version: 'grading-v1' },
    }, 'error-prepare'), definition);
    outcome = transition(outcome.state, command('start_challenge', { challenge_id: errorChallenge }, 'error-start'), definition);
    const failed = transition(outcome.state, command('submit_challenge_result', {
      challenge_id: errorChallenge,
      result: { status: 'error', score: null, metrics: { reason: 'midi_disconnected' }, provider_version: 'provider-v1' },
    }, 'error-result'), definition);
    expect(failed.state.practice_attempts).toHaveLength(1);
    expect(failed.state).toMatchObject({ pending_action: null, ranked: false });
    expect(failed.events).toContainEqual(expect.objectContaining({ type: 'challenge_interrupted', refunded: true }));
  });

  it('preserves practice evidence across checkpoints and a same-opponent retry', () => {
    let state = createInitialState(definition, {
      seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'squirtle' },
    });
    state.enemy.health = 1;
    let outcome = resolveMove(state, 'water-gun', { score: 0.8 }, 'checkpoint');
    expect(outcome.state).toMatchObject({ phase: 'checkpoint', completed_encounters: ['pidgey'] });
    expect(deriveInteraction(outcome.state, definition).legal_commands).toContainEqual(expect.objectContaining({ type: 'continue_encounter' }));

    outcome = transition(outcome.state, command('continue_encounter', {}, 'continue'), definition);
    expect(outcome.state).toMatchObject({ phase: 'battle', current_encounter: 1, player: { health: 100 } });
    expect(outcome.state.zones.hand.map((move) => definition.cards[move.definition_id].challenge.kind))
      .toEqual(['scale', 'chord', 'arpeggio', 'timed-pattern']);
    outcome.state.player.health = 1;
    outcome.state.enemy.intent = { id: 'fatal', title: 'Fatal Scratch', kind: 'attack', amount: 999 };
    outcome = resolveMove(outcome.state, 'water-gun', { score: 0.4 }, 'defeat');
    expect(outcome.state).toMatchObject({ phase: 'defeated', player: { health: 0 } });
    const attempts = outcome.state.practice_attempts.length;
    outcome = transition(outcome.state, command('retry_encounter', {}, 'retry'), definition);
    expect(outcome.state).toMatchObject({ phase: 'battle', current_encounter: 1, player: { health: 100 } });
    expect(outcome.state.practice_attempts).toHaveLength(attempts);
  });

  it('offers only new recruitment candidates and skips the decision when both are owned', () => {
    const atSecondBattle = (caughtIds) => {
      const state = createInitialState(definition, {
        seed: 7,
        participants: [{ user_id: 'kid-1' }],
        setup: { partner_id: 'bulbasaur', caught_ids: caughtIds },
      });
      state.completed_encounters = [state.route_plan[0].id];
      state.current_encounter = 1;
      state.enemy = { ...state.enemy, ...state.route_plan[1], health: 1, max_health: state.route_plan[1].health };
      return state;
    };
    const firstId = createInitialState(definition, { seed: 7, setup: { partner_id: 'bulbasaur' } }).route_plan[0].id;
    const secondId = createInitialState(definition, { seed: 7, setup: { partner_id: 'bulbasaur' } }).route_plan[1].id;

    const single = resolveMove(atSecondBattle([firstId]), 'vine-whip', { score: 0.8 }, 'single-recruit');
    expect(single.state).toMatchObject({ phase: 'recruitment', recruitment_candidates: [secondId] });
    expect(deriveInteraction(single.state, definition).legal_commands).toEqual([
      expect.objectContaining({ type: 'select_recruit', payload: { recruit_id: secondId } }),
    ]);

    const skipped = resolveMove(atSecondBattle([firstId, secondId]), 'vine-whip', { score: 0.8 }, 'skip-recruit');
    expect(skipped.state).toMatchObject({ phase: 'checkpoint', recruitment_candidates: [] });
    expect(skipped.events).toContainEqual({ type: 'recruitment_skipped', reason: 'candidates_already_owned' });
  });

  it('computes the ranked 10,000-point run score from piano evidence only', () => {
    const state = createInitialState(definition, {
      seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'bulbasaur' },
    });
    state.completed_encounters = ['pidgey', 'meowth', 'snorlax'];
    state.practice_attempts = ['scale', 'chord', 'arpeggio', 'timed-pattern', 'scale', 'chord'].map((kind, index) => ({
      status: 'completed', score: 1, first_pass: true, kind,
      provider_version: 'provider-v1', grading_policy_version: 'grading-v1', attempt_id: `attempt-${index}`,
    }));
    expect(computePokemonJourneyScore(state, definition)).toMatchObject({
      score: 10000,
      qualified: true,
      completed_performances: 6,
      breakdown: {
        mean_challenge_score: 1,
        first_pass_rate: 1,
        opponent_completion_rate: 1,
        skill_family_breadth: 1,
      },
    });
  });
});
