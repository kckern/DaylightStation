import {
  CHALLENGE_STATES,
  COMMAND_TYPES,
  gamingError,
  isChallengeResult,
} from './contracts.mjs';
import { assertDefinition } from './definition.mjs';
import { shuffle } from './rng.mjs';

const clone = (value) => structuredClone(value);
const isTactical = (definition) => definition.card_battle.turn_mode === 'tactical';

function instantiateDeck(definition, seed) {
  const counts = new Map();
  const instances = definition.card_battle.deck.map((definitionId) => {
    const n = (counts.get(definitionId) || 0) + 1;
    counts.set(definitionId, n);
    return { instance_id: `${definitionId}:${n}`, definition_id: definitionId };
  });
  return shuffle(instances, seed);
}

function drawCards(state, count) {
  for (let i = 0; i < count; i += 1) {
    if (state.zones.deck.length === 0 && state.zones.discard.length > 0) {
      const shuffled = shuffle(state.zones.discard, state.rng_state);
      state.zones.deck = shuffled.items;
      state.zones.discard = [];
      state.rng_state = shuffled.rngState;
    }
    const card = state.zones.deck.shift();
    if (!card) break;
    state.zones.hand.push(card);
  }
}

export function createInitialState(definition, { seed = 1, participants = [], setup = {} } = {}) {
  const def = assertDefinition(definition);
  const shuffled = instantiateDeck(def, seed);
  const enemyConfig = clone(def.card_battle.enemy);
  const openingIntent = isTactical(def) ? clone(enemyConfig.intents[0]) : null;
  const upgrade = (def.card_battle.upgrades || []).find((candidate) => candidate.id === setup.upgrade_id) || null;
  const healthBonus = upgrade?.effect?.max_health || 0;
  const startingFocus = upgrade?.effect?.starting_focus || 0;
  const state = {
    schema_version: 1,
    ruleset: def.ruleset,
    status: 'active',
    turn: 1,
    actor: 'player',
    participants: clone(participants),
    player: {
      health: def.card_battle.player.health + healthBonus,
      max_health: def.card_battle.player.health + healthBonus,
      energy: def.card_battle.player.max_energy,
      max_energy: def.card_battle.player.max_energy,
      block: 0,
      focus: startingFocus,
    },
    enemy: {
      ...enemyConfig,
      max_health: def.card_battle.enemy.health,
      block: 0,
      strength: 0,
      intent_index: 0,
      intent: openingIntent,
    },
    zones: { deck: shuffled.items, hand: [], discard: [] },
    pending_action: null,
    winner: null,
    rng_state: shuffled.rngState,
    challenge_cursor: Number(seed) >>> 0,
    cards_played_this_turn: 0,
    score: 0,
    applied_upgrade: upgrade ? { id: upgrade.id, title: upgrade.title } : null,
  };
  drawCards(state, def.card_battle.opening_hand ?? 3);
  return state;
}

function failure(state, code, message, details = null) {
  return { state, events: [], yield: deriveYield(state), error: gamingError(code, message, details) };
}

function success(state, events) {
  return { state, events, yield: deriveYield(state), error: null };
}

function selectOutcome(card, score) {
  return card.outcomes.find((candidate) => score >= candidate.min_score) || card.outcomes.at(-1);
}

function resolveChallenge(card, definition, state) {
  let prompt = null;
  if (!card.challenge.pool) {
    prompt = card.challenge.prompt ? clone(card.challenge.prompt) : null;
  } else {
    const prompts = definition.card_battle.challenge_pools[card.challenge.pool].prompts;
    const index = state.challenge_cursor % prompts.length;
    state.challenge_cursor += 1;
    prompt = clone(prompts[index]);
  }
  return prompt;
}

function deriveYield(state) {
  if (state.status !== 'active') return { type: 'terminal', winner: state.winner, status: state.status };
  if (state.pending_action) {
    return {
      type: 'challenge',
      lifecycle: state.pending_action.status,
      request: clone(state.pending_action.request),
      prepared: clone(state.pending_action.prepared),
    };
  }
  return { type: 'player_choice' };
}

function chooseAction(state, command, definition) {
  if (state.status !== 'active') return failure(state, 'session_terminal', 'The game is already complete');
  if (state.pending_action) return failure(state, 'action_pending', 'Resolve the pending challenge first');
  const cardInstanceId = command.payload?.card_instance_id;
  const cardInstance = state.zones.hand.find((card) => card.instance_id === cardInstanceId);
  if (!cardInstance) return failure(state, 'card_not_in_hand', 'Selected card is not in hand');
  const card = definition.cards[cardInstance.definition_id];
  if (card.cost > state.player.energy) return failure(state, 'insufficient_energy', 'Not enough energy for this card');

  const next = clone(state);
  const challengeSequence = next.challenge_cursor;
  const prompt = resolveChallenge(card, definition, next);
  if (!card.challenge.pool) next.challenge_cursor += 1;
  next.pending_action = {
    id: `challenge:${command.command_id}`,
    status: CHALLENGE_STATES.REQUESTED,
    card_instance_id: cardInstanceId,
    card_definition_id: cardInstance.definition_id,
    reserved_cost: card.cost,
    prepared: null,
    request: {
      challenge_id: `challenge:${command.command_id}`,
      domain: card.challenge.domain,
      kind: card.challenge.kind,
      user_id: state.participants[0]?.user_id || state.participants[0]?.id || 'guest',
      ...(prompt ? { prompt } : {}),
      requirements: clone(card.challenge.requirements || {}),
      timeout_ms: card.challenge.timeout_ms ?? null,
      context: {
        action_id: command.command_id,
        turn: state.turn,
        challenge_pool: card.challenge.pool || null,
        challenge_sequence: challengeSequence,
      },
    },
  };
  return success(next, [{ type: 'action_pending', action_id: command.command_id, card_instance_id: cardInstanceId }]);
}

function prepareChallenge(state, command) {
  const pending = state.pending_action;
  if (!pending) return failure(state, 'no_pending_action', 'No challenge is pending');
  if (pending.status !== CHALLENGE_STATES.REQUESTED) return failure(state, 'invalid_challenge_state', 'Challenge is not awaiting preparation');
  if (command.payload?.challenge_id !== pending.id) return failure(state, 'challenge_mismatch', 'Prepared challenge does not match the pending action');
  const prepared = command.payload?.prepared;
  if (!prepared || typeof prepared !== 'object') return failure(state, 'invalid_prepared_challenge', 'prepared snapshot is required');
  const next = clone(state);
  next.pending_action.status = CHALLENGE_STATES.PREPARED;
  next.pending_action.prepared = clone(prepared);
  return success(next, [{ type: 'challenge_prepared', challenge_id: pending.id }]);
}

function startChallenge(state, command) {
  const pending = state.pending_action;
  if (!pending) return failure(state, 'no_pending_action', 'No challenge is pending');
  if (pending.status !== CHALLENGE_STATES.PREPARED) return failure(state, 'invalid_challenge_state', 'Challenge is not prepared');
  if (command.payload?.challenge_id !== pending.id) return failure(state, 'challenge_mismatch', 'Challenge id does not match');
  const next = clone(state);
  next.pending_action.status = CHALLENGE_STATES.STARTED;
  return success(next, [{ type: 'challenge_started', challenge_id: pending.id }]);
}

function applyTerminalResult(state, command, definition) {
  const pending = state.pending_action;
  const result = command.payload?.result;
  if (!pending) return failure(state, 'no_pending_action', 'No challenge is pending');
  if (pending.status !== CHALLENGE_STATES.STARTED) return failure(state, 'invalid_challenge_state', 'Challenge has not started');
  if (command.payload?.challenge_id !== pending.id) return failure(state, 'challenge_mismatch', 'Result does not match the pending challenge');
  if (!isChallengeResult(result)) return failure(state, 'invalid_challenge_result', 'Challenge result is invalid');

  const next = clone(state);
  if (result.status !== 'completed') {
    next.pending_action = null;
    return success(next, [{ type: 'challenge_interrupted', challenge_id: pending.id, status: result.status }]);
  }

  const card = definition.cards[pending.card_definition_id];
  const outcome = selectOutcome(card, result.score);
  const multiplier = outcome.multiplier ?? 1;
  next.player.block ??= 0;
  next.player.focus ??= 0;
  next.enemy.block ??= 0;
  next.enemy.strength ??= 0;
  next.player.energy -= pending.reserved_cost;
  const cardIndex = next.zones.hand.findIndex((item) => item.instance_id === pending.card_instance_id);
  const [playedCard] = cardIndex >= 0 ? next.zones.hand.splice(cardIndex, 1) : [];
  if (playedCard) next.zones.discard.push(playedCard);
  next.pending_action = null;
  next.cards_played_this_turn = (next.cards_played_this_turn ?? 0) + 1;
  next.score = (next.score ?? 0) + Math.round(result.score * 100);

  const events = [
    { type: 'challenge_resolved', challenge_id: pending.id, score: result.score, outcome: outcome.id },
  ];
  const cardType = card.type || 'attack';
  if (cardType === 'guard') {
    const block = Math.max(0, Math.round(card.block * multiplier));
    next.player.block += block;
    events.push({ type: 'block_gained', target: 'player', amount: block });
  } else if (cardType === 'focus') {
    const focus = Math.max(0, Math.round(card.focus * multiplier));
    next.player.focus += focus;
    events.push({ type: 'focus_gained', target: 'player', amount: focus });
  } else {
    const baseDamage = Math.max(0, Math.round(card.damage * multiplier));
    const focus = next.player.focus;
    const attemptedDamage = baseDamage + focus;
    const blocked = Math.min(next.enemy.block, attemptedDamage);
    const damage = Math.max(0, attemptedDamage - blocked);
    next.enemy.block -= blocked;
    next.enemy.health = Math.max(0, next.enemy.health - damage);
    if (focus > 0) {
      next.player.focus = 0;
      events.push({ type: 'focus_spent', amount: focus });
    }
    if (blocked > 0) events.push({ type: 'damage_blocked', target: 'enemy', amount: blocked });
    events.push({ type: 'damage_dealt', target: 'enemy', amount: damage, attempted: attemptedDamage });
  }
  if (next.enemy.health === 0) {
    next.status = 'complete';
    next.winner = 'player';
    events.push({ type: 'game_ended', winner: 'player' });
    return success(next, events);
  }

  if (isTactical(definition)) return success(next, events);

  const retaliation = definition.card_battle.enemy.attack;
  next.player.health = Math.max(0, next.player.health - retaliation);
  events.push({ type: 'damage_dealt', target: 'player', amount: retaliation });
  if (next.player.health === 0) {
    next.status = 'complete';
    next.winner = 'enemy';
    events.push({ type: 'game_ended', winner: 'enemy' });
    return success(next, events);
  }

  next.turn += 1;
  next.player.energy = next.player.max_energy;
  drawCards(next, 1);
  events.push({ type: 'turn_started', turn: next.turn, actor: 'player' });
  return success(next, events);
}

function endTurn(state, definition) {
  if (!isTactical(definition)) return failure(state, 'unsupported_command', 'This battle does not use tactical turns');
  if (state.status !== 'active') return failure(state, 'session_terminal', 'The game is already complete');
  if (state.pending_action) return failure(state, 'action_pending', 'Resolve the pending challenge first');

  const next = clone(state);
  const intent = next.enemy.intent;
  const events = [];
  next.enemy.block = 0;
  next.player.block = Math.max(0, next.player.block);

  if (intent.kind === 'attack') {
    const attempted = intent.amount + next.enemy.strength;
    const blocked = Math.min(next.player.block, attempted);
    const damage = Math.max(0, attempted - blocked);
    next.player.block = 0;
    next.enemy.strength = 0;
    next.player.health = Math.max(0, next.player.health - damage);
    events.push({ type: 'enemy_intent_resolved', intent_id: intent.id, kind: intent.kind, title: intent.title, amount: attempted });
    if (blocked > 0) events.push({ type: 'damage_blocked', target: 'player', amount: blocked });
    events.push({ type: 'damage_dealt', target: 'player', amount: damage, attempted });
  } else if (intent.kind === 'defend') {
    next.player.block = 0;
    next.enemy.block = intent.amount;
    events.push({ type: 'enemy_intent_resolved', intent_id: intent.id, kind: intent.kind, title: intent.title, amount: intent.amount });
    events.push({ type: 'block_gained', target: 'enemy', amount: intent.amount });
  } else {
    next.player.block = 0;
    next.enemy.strength += intent.amount;
    events.push({ type: 'enemy_intent_resolved', intent_id: intent.id, kind: intent.kind, title: intent.title, amount: intent.amount });
    events.push({ type: 'focus_gained', target: 'enemy', amount: intent.amount });
  }

  if (next.player.health === 0) {
    next.status = 'complete';
    next.winner = 'enemy';
    events.push({ type: 'game_ended', winner: 'enemy' });
    return success(next, events);
  }

  next.score = (next.score ?? 0) + 25;
  next.zones.discard.push(...next.zones.hand);
  next.zones.hand = [];
  next.turn += 1;
  next.cards_played_this_turn = 0;
  next.player.energy = next.player.max_energy;
  drawCards(next, definition.card_battle.hand_size);
  next.enemy.intent_index = (next.enemy.intent_index + 1) % definition.card_battle.enemy.intents.length;
  next.enemy.intent = clone(definition.card_battle.enemy.intents[next.enemy.intent_index]);
  events.push({ type: 'turn_started', turn: next.turn, actor: 'player', enemy_intent: clone(next.enemy.intent) });
  return success(next, events);
}

function abortPendingAction(state, command) {
  const pending = state.pending_action;
  if (!pending) return failure(state, 'no_pending_action', 'No challenge is pending');
  if (command.payload?.challenge_id && command.payload.challenge_id !== pending.id) {
    return failure(state, 'challenge_mismatch', 'Abort does not match the pending challenge');
  }
  const reason = String(command.payload?.reason || 'aborted');
  const next = clone(state);
  next.pending_action = null;
  return success(next, [{ type: 'action_aborted', challenge_id: pending.id, reason }]);
}

function abandonSession(state, command) {
  if (state.status !== 'active') return failure(state, 'session_terminal', 'The game is already terminal');
  const next = clone(state);
  const pending = next.pending_action;
  next.status = 'abandoned';
  next.pending_action = null;
  next.winner = null;
  const reason = String(command.payload?.reason || 'player_closed');
  const events = [];
  if (pending) events.push({ type: 'challenge_interrupted', challenge_id: pending.id, status: 'aborted', reason });
  events.push({ type: 'session_abandoned', reason });
  return success(next, events);
}

export function transition(state, command, definition) {
  const def = assertDefinition(definition);
  if (!state || typeof state !== 'object') return failure(state, 'invalid_state', 'State is required');
  switch (command.type) {
    case COMMAND_TYPES.CHOOSE_ACTION: return chooseAction(state, command, def);
    case COMMAND_TYPES.END_TURN: return endTurn(state, def);
    case COMMAND_TYPES.PREPARE_CHALLENGE: return prepareChallenge(state, command);
    case COMMAND_TYPES.START_CHALLENGE: return startChallenge(state, command);
    case COMMAND_TYPES.SUBMIT_CHALLENGE_RESULT: return applyTerminalResult(state, command, def);
    case COMMAND_TYPES.ABORT_PENDING_ACTION: return abortPendingAction(state, command);
    case COMMAND_TYPES.ABANDON_SESSION: return abandonSession(state, command);
    default: return failure(state, 'unsupported_command', `Unsupported command: ${command.type}`);
  }
}

export function deriveInteraction(state, definition, viewerId = null) {
  const def = assertDefinition(definition);
  const legalCommands = [];
  if (state.status === 'active' && !state.pending_action) {
    for (const instance of state.zones.hand) {
      const card = def.cards[instance.definition_id];
      if (card.cost <= state.player.energy) {
        legalCommands.push({ type: COMMAND_TYPES.CHOOSE_ACTION, payload: { card_instance_id: instance.instance_id } });
      }
    }
    if (isTactical(def)) legalCommands.push({ type: COMMAND_TYPES.END_TURN, payload: {} });
  }
  return { viewer_id: viewerId, legal_commands: legalCommands, yield: deriveYield(state) };
}

export { deriveYield };
