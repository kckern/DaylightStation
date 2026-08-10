import { describe, expect, it } from 'vitest';
import { scaleClashDefinition } from './fixtures/scaleClash.mjs';
import { createInitialState, deriveInteraction, transition } from './reducer.mjs';

function command(type, revision, payload, id = `${type}-${revision}`) {
  return { command_id: id, session_revision: revision, type, payload };
}

const tacticalDefinition = {
  schema_version: 1,
  game_id: 'tactical-test',
  title: 'Tactical Test',
  view_id: 'card-battle-v1',
  ruleset: 'card-battle-v1',
  players: { min: 1, max: 1 },
  card_battle: {
    turn_mode: 'tactical', opening_hand: 4, hand_size: 4,
    player: { health: 10, max_energy: 3 },
    enemy: {
      id: 'foe', name: 'Foe', health: 20,
      intents: [
        { id: 'hit', title: 'Hit', kind: 'attack', amount: 4 },
        { id: 'brace', title: 'Brace', kind: 'defend', amount: 3 },
      ],
    },
    challenge_pools: {
      chords: {
        prompts: [
          { label: 'C', pitch_classes: [0, 4, 7] },
          { label: 'F', pitch_classes: [5, 9, 0] },
        ],
      },
    },
    deck: ['jab', 'jab', 'guard', 'focus'],
  },
  cards: {
    jab: {
      title: 'Jab', type: 'attack', cost: 1, damage: 2,
      challenge: { domain: 'piano', kind: 'chord', pool: 'chords' },
      outcomes: [{ id: 'full', min_score: 1, multiplier: 1 }, { id: 'miss', min_score: 0, multiplier: 0 }],
    },
    guard: {
      title: 'Guard', type: 'guard', cost: 1, block: 4,
      challenge: { domain: 'piano', kind: 'chord', pool: 'chords' },
      outcomes: [{ id: 'full', min_score: 1, multiplier: 1 }, { id: 'miss', min_score: 0, multiplier: 0 }],
    },
    focus: {
      title: 'Focus', type: 'focus', cost: 1, focus: 3,
      challenge: { domain: 'piano', kind: 'chord', pool: 'chords' },
      outcomes: [{ id: 'full', min_score: 1, multiplier: 1 }, { id: 'miss', min_score: 0, multiplier: 0 }],
    },
  },
};

function playCard(state, definitionId, score, id) {
  const card = state.zones.hand.find((item) => item.definition_id === definitionId);
  let result = transition(state, command('choose_action', 0, { card_instance_id: card.instance_id }, `${id}-choose`), tacticalDefinition);
  const challengeId = result.state.pending_action.id;
  result = transition(result.state, command('prepare_challenge', 1, { challenge_id: challengeId, prepared: { id } }, `${id}-prepare`), tacticalDefinition);
  result = transition(result.state, command('start_challenge', 2, { challenge_id: challengeId }, `${id}-start`), tacticalDefinition);
  return transition(result.state, command('submit_challenge_result', 3, {
    challenge_id: challengeId,
    result: { status: 'completed', score, metrics: {}, provider_version: 'test', attempt_id: id },
  }, `${id}-result`), tacticalDefinition);
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

  it('authoritatively abandons a session and interrupts any pending challenge', () => {
    const initial = createInitialState(scaleClashDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    const card = initial.zones.hand[0];
    const chosen = transition(initial, command('choose_action', 0, { card_instance_id: card.instance_id }, 'choose-abandon'), scaleClashDefinition);
    const result = transition(chosen.state, command('abandon_session', 1, { reason: 'player_closed' }, 'abandon'), scaleClashDefinition);
    expect(result.state).toMatchObject({ status: 'abandoned', pending_action: null, winner: null });
    expect(result.yield).toMatchObject({ type: 'terminal', status: 'abandoned' });
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'challenge_interrupted', reason: 'player_closed' }),
      { type: 'session_abandoned', reason: 'player_closed' },
    ]);
  });

  it('supports multiple card verbs in one tactical turn and spends focus on the next attack', () => {
    let state = createInitialState(tacticalDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    expect(deriveInteraction(state, tacticalDefinition).legal_commands).toHaveLength(5);

    let result = playCard(state, 'focus', 1, 'focus');
    expect(result.state.turn).toBe(1);
    expect(result.state.player).toMatchObject({ energy: 2, focus: 3 });

    result = playCard(result.state, 'jab', 1, 'jab');
    expect(result.state.turn).toBe(1);
    expect(result.state.player).toMatchObject({ energy: 1, focus: 0 });
    expect(result.state.enemy.health).toBe(15);
    expect(result.events).toContainEqual({ type: 'focus_spent', amount: 3 });
  });

  it('selects challenge content from the pool after the tactical card is chosen', () => {
    const state = createInitialState(tacticalDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    const card = state.zones.hand.find((item) => item.definition_id === 'guard');
    const result = transition(state, command('choose_action', 0, { card_instance_id: card.instance_id }, 'pooled'), tacticalDefinition);
    expect(tacticalDefinition.cards.guard.challenge.prompt).toBeUndefined();
    expect(result.state.pending_action.request.context.challenge_pool).toBe('chords');
    expect(['C', 'F']).toContain(result.state.pending_action.request.prompt.label);
  });

  it('resolves announced enemy intent against block, redraws, and advances the intent', () => {
    const initial = createInitialState(tacticalDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    const guarded = playCard(initial, 'guard', 1, 'guard').state;
    const result = transition(guarded, command('end_turn', 4, {}, 'end'), tacticalDefinition);
    expect(result.state.player.health).toBe(initial.player.health);
    expect(result.state.player.block).toBe(0);
    expect(result.state.turn).toBe(2);
    expect(result.state.player.energy).toBe(3);
    expect(result.state.zones.hand).toHaveLength(4);
    expect(result.state.enemy.intent).toMatchObject({ kind: 'defend', amount: 3 });
    expect(result.events).toContainEqual({ type: 'damage_blocked', target: 'player', amount: 4 });
  });

  it('allows the announced enemy attack to defeat an unprotected player', () => {
    const state = createInitialState(tacticalDefinition, { seed: 7, participants: [{ user_id: 'guest' }] });
    state.player.health = 3;
    const result = transition(state, command('end_turn', 0, {}, 'fatal-end'), tacticalDefinition);
    expect(result.state).toMatchObject({ status: 'complete', winner: 'enemy' });
  });
});
