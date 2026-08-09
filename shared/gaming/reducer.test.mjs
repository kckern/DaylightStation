import { describe, expect, it } from 'vitest';
import { scaleClashDefinition } from './fixtures/scaleClash.mjs';
import { createInitialState, deriveInteraction, transition } from './reducer.mjs';

function command(type, revision, payload, id = `${type}-${revision}`) {
  return { command_id: id, session_revision: revision, type, payload };
}

describe('gaming card-slice reducer', () => {
  it('exposes legal actions without requiring the view to duplicate rules', () => {
    const state = createInitialState(scaleClashDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    const interaction = deriveInteraction(state, scaleClashDefinition, 'guest');
    expect(interaction.yield.type).toBe('player_choice');
    expect(interaction.legal_commands).toHaveLength(3);
  });

  it('persists each recoverable challenge lifecycle boundary', () => {
    let state = createInitialState(scaleClashDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    const card = state.zones.hand[0];
    let result = transition(state, command('choose_action', 0, { card_instance_id: card.instance_id }, 'choose'), scaleClashDefinition);
    expect(result.error).toBeNull();
    expect(result.state.pending_action.status).toBe('requested');
    const challengeId = result.state.pending_action.id;

    result = transition(result.state, command('prepare_challenge', 1, {
      challenge_id: challengeId,
      prepared: { challenge_id: challengeId, prompt: { label: 'C' }, grading_policy_version: 'test' },
    }), scaleClashDefinition);
    expect(result.state.pending_action.status).toBe('prepared');

    result = transition(result.state, command('start_challenge', 2, { challenge_id: challengeId }), scaleClashDefinition);
    expect(result.state.pending_action.status).toBe('started');

    const enemyBefore = result.state.enemy.health;
    result = transition(result.state, command('submit_challenge_result', 3, {
      challenge_id: challengeId,
      result: { status: 'completed', score: 1, metrics: {}, provider_version: 'test', attempt_id: 'attempt-1' },
    }), scaleClashDefinition);
    expect(result.error).toBeNull();
    expect(result.state.pending_action).toBeNull();
    expect(result.state.enemy.health).toBeLessThan(enemyBefore);
    expect(result.state.turn).toBe(2);
  });

  it('refunds an interrupted challenge without consuming the card', () => {
    const initial = createInitialState(scaleClashDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    const card = initial.zones.hand[0];
    let result = transition(initial, command('choose_action', 0, { card_instance_id: card.instance_id }, 'choose'), scaleClashDefinition);
    const challengeId = result.state.pending_action.id;
    result = transition(result.state, command('prepare_challenge', 1, { challenge_id: challengeId, prepared: { id: 'p' } }), scaleClashDefinition);
    result = transition(result.state, command('start_challenge', 2, { challenge_id: challengeId }), scaleClashDefinition);
    result = transition(result.state, command('submit_challenge_result', 3, {
      challenge_id: challengeId,
      result: { status: 'aborted', score: null, metrics: {}, provider_version: 'test', attempt_id: null },
    }), scaleClashDefinition);
    expect(result.state.player.energy).toBe(initial.player.energy);
    expect(result.state.zones.hand.map((item) => item.instance_id)).toContain(card.instance_id);
  });
});
