import {
  CHALLENGE_STATES,
  COMMAND_TYPES,
  gamingError,
  isChallengeResult,
} from './contracts.mjs';
import { shuffle } from './rng.mjs';

export const POKEMON_JOURNEY_RULESET = 'pokemon-practice-journey-v1';
export const POKEMON_JOURNEY_SCORE_VERSION = 1;

const clone = (value) => structuredClone(value);

function failure(state, code, message, details = null) {
  return { state, events: [], yield: derivePokemonJourneyYield(state), error: gamingError(code, message, details) };
}

function success(state, events) {
  return { state, events, yield: derivePokemonJourneyYield(state), error: null };
}

function partnerFor(definition, partnerId) {
  return definition.journey.partners.find((candidate) => candidate.id === partnerId) || null;
}

function moveInstances(definition, partnerId) {
  const partner = partnerFor(definition, partnerId);
  return partner.move_ids.map((definitionId, index) => ({
    instance_id: `${definitionId}:${index + 1}`,
    definition_id: definitionId,
  }));
}

function makeEnemyFrom(opponent, rngState) {
  const shuffled = shuffle(opponent.intents, rngState);
  return {
    ...clone(opponent),
    health: opponent.health,
    max_health: opponent.health,
    block: 0,
    strength: 0,
    intent_index: 0,
    intent_deck: shuffled.items,
    intent: clone(shuffled.items[0]),
    rng_state: shuffled.rngState,
  };
}

function drawRoute(definition, seed, unseenIds = []) {
  const tiers = definition.journey.opponent_tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { route: clone(definition.journey.opponents), rngState: Number(seed) >>> 0 };
  }
  const unseen = new Set(unseenIds);
  const used = new Set();
  let rngState = Number(seed) >>> 0;
  const route = [];
  for (const tier of tiers) {
    const preferred = tier.pool.filter((candidate) => unseen.has(candidate.id) && !used.has(candidate.id));
    const eligible = preferred.length > 0 ? preferred : tier.pool.filter((candidate) => !used.has(candidate.id));
    const shuffled = shuffle(eligible.length > 0 ? eligible : tier.pool, rngState);
    rngState = shuffled.rngState;
    const selected = shuffled.items[0];
    route.push({ ...clone(selected), tier: tier.id });
    used.add(selected.id);
  }
  return { route, rngState };
}

export function computePokemonJourneyScore(state, definition) {
  const attempts = state.practice_attempts || [];
  const normalizedScores = attempts.map((attempt) => Number(attempt.score) || 0);
  const meanScore = normalizedScores.length > 0
    ? normalizedScores.reduce((total, score) => total + score, 0) / normalizedScores.length
    : 0;
  const firstPassRate = attempts.length > 0
    ? attempts.filter((attempt) => attempt.first_pass).length / attempts.length
    : 0;
  const inGymCampaign = state.campaign_stage === 'gym'
    || (definition.journey.gym?.opponents || []).some((opponent) => state.completed_encounters?.includes(opponent.id));
  const legacyCompleted = definition.journey.opponents.every((opponent) => state.completed_encounters?.includes(opponent.id));
  const routeWins = legacyCompleted && state.completed_encounters?.length === definition.journey.opponents.length
    ? definition.journey.opponents.length
    : state.route_plan?.length || definition.journey.opponents.length;
  const campaignRequiredWins = routeWins + (inGymCampaign ? (definition.journey.gym?.opponents?.length || 0) : 0);
  const opponentRate = (state.completed_encounters?.length || 0) / campaignRequiredWins;
  const breadth = new Set(attempts.filter((attempt) => attempt.status === 'completed').map((attempt) => attempt.kind)).size / 4;
  const completedPerformances = attempts.filter((attempt) => attempt.status === 'completed').length;
  const qualified = state.completed_encounters.length === campaignRequiredWins
    && completedPerformances >= 6
    && state.ranked !== false;
  const score = Math.max(0, Math.min(10_000, Math.round(
    8_500 * meanScore
      + 1_000 * firstPassRate
      + 300 * opponentRate
      + 200 * Math.min(1, breadth),
  )));
  return {
    score,
    qualified,
    score_version: definition.journey.score_version || POKEMON_JOURNEY_SCORE_VERSION,
    journey_version: definition.journey.version,
    provider_versions: [...new Set(attempts.map((attempt) => attempt.provider_version).filter(Boolean))],
    grading_versions: [...new Set(attempts.map((attempt) => attempt.grading_policy_version).filter(Boolean))],
    partner_id: state.partner_id,
    completed_performances: completedPerformances,
    breakdown: {
      mean_challenge_score: meanScore,
      first_pass_rate: firstPassRate,
      opponent_completion_rate: opponentRate,
      skill_family_breadth: Math.min(1, breadth),
      attempts: attempts.length,
    },
  };
}

export function createPokemonJourneyInitialState(definition, { seed = 1, participants = [], setup = {} } = {}) {
  const partner = partnerFor(definition, setup.partner_id);
  if (!partner) throw new Error('A valid partner_id is required for the Pokémon practice journey');
  const maxHealth = definition.journey.player_health;
  const drawn = drawRoute(definition, Number(seed) >>> 0, setup.unseen_ids || []);
  const enemy = makeEnemyFrom(drawn.route[0], drawn.rngState);
  return {
    schema_version: 1,
    ruleset: POKEMON_JOURNEY_RULESET,
    status: 'active',
    phase: 'battle',
    winner: null,
    participants: clone(participants),
    partner_id: partner.id,
    turn: 1,
    current_encounter: 0,
    route_plan: drawn.route,
    gym_plan: (definition.journey.gym?.opponents || []).map((opponent) => opponent.id),
    gym_encounter_index: null,
    campaign_stage: 'route',
    completed_encounters: [],
    recruitment_choices: [],
    recruitment_candidates: [],
    owned_pokemon_ids: [...new Set([partner.id, ...(setup.caught_ids || [])])],
    roster: definition.journey.partners.map((candidate) => ({
      partner_id: candidate.id,
      owned: candidate.id === partner.id,
      health: maxHealth,
      max_health: maxHealth,
      fainted: false,
    })),
    gym_finisher_used: false,
    queued_ceremony_ids: [],
    completed_ceremony_ids: [],
    suspended_at: null,
    player: {
      name: partner.name,
      health: maxHealth,
      max_health: maxHealth,
      energy: 4,
      max_energy: 4,
      block: 0,
      focus: 0,
    },
    enemy,
    zones: { deck: [], hand: moveInstances(definition, partner.id).slice(0, 3), discard: [] },
    pending_action: null,
    practice_attempts: [],
    challenge_cursor: Number(seed) >>> 0,
    rng_state: enemy.rng_state,
    ranked: true,
    unranked_reasons: [],
    score: 0,
    journey_summary: null,
  };
}

function chooseMove(state, command, definition) {
  if (state.status !== 'active' || state.phase !== 'battle') return failure(state, 'encounter_not_active', 'Continue or retry the journey first');
  if (state.pending_action) return failure(state, 'action_pending', 'Resolve the pending practice challenge first');
  const instance = state.zones.hand.find((candidate) => candidate.instance_id === command.payload?.card_instance_id);
  if (!instance) return failure(state, 'move_not_available', 'Selected move is unavailable');
  const move = definition.cards[instance.definition_id];
  if (move.signature && state.completed_encounters.length === 0) {
    return failure(state, 'move_locked', 'Defeat Pidgey to unlock the signature move');
  }
  if (move.finisher && state.gym_finisher_used) return failure(state, 'move_used', 'The gym finisher has already been used');
  const next = clone(state);
  const challengeId = `challenge:${command.command_id}`;
  next.pending_action = {
    id: challengeId,
    status: CHALLENGE_STATES.REQUESTED,
    card_instance_id: instance.instance_id,
    card_definition_id: instance.definition_id,
    reserved_cost: 0,
    prepared: null,
    request: {
      challenge_id: challengeId,
      domain: move.challenge.domain,
      kind: move.challenge.kind,
      user_id: state.participants[0]?.user_id || state.participants[0]?.id || 'guest',
      requirements: clone(move.challenge.requirements || {}),
      timeout_ms: move.challenge.timeout_ms ?? null,
      context: {
        action_id: command.command_id,
        turn: state.turn,
        encounter_index: state.current_encounter,
        challenge_sequence: state.challenge_cursor,
        partner_id: state.partner_id,
        move_id: instance.definition_id,
      },
    },
  };
  next.challenge_cursor += 1;
  return success(next, [{ type: 'action_pending', action_id: command.command_id, card_instance_id: instance.instance_id }]);
}

function prepareChallenge(state, command) {
  const pending = state.pending_action;
  if (!pending) return failure(state, 'no_pending_action', 'No challenge is pending');
  if (pending.status !== CHALLENGE_STATES.REQUESTED) return failure(state, 'invalid_challenge_state', 'Challenge is not awaiting preparation');
  if (command.payload?.challenge_id !== pending.id) return failure(state, 'challenge_mismatch', 'Prepared challenge does not match the pending action');
  if (!command.payload?.prepared || typeof command.payload.prepared !== 'object') {
    return failure(state, 'invalid_prepared_challenge', 'prepared snapshot is required');
  }
  const next = clone(state);
  next.pending_action.status = CHALLENGE_STATES.PREPARED;
  next.pending_action.prepared = clone(command.payload.prepared);
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

function selectOutcome(move, score) {
  return move.outcomes.find((candidate) => score >= candidate.min_score) || move.outcomes.at(-1);
}

function resolveEnemyAction(next, events) {
  const intent = next.enemy.intent;
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
    next.enemy.block = intent.amount;
    events.push({ type: 'enemy_intent_resolved', intent_id: intent.id, kind: intent.kind, title: intent.title, amount: intent.amount });
    events.push({ type: 'block_gained', target: 'enemy', amount: intent.amount });
  } else {
    next.enemy.strength += intent.amount;
    events.push({ type: 'enemy_intent_resolved', intent_id: intent.id, kind: intent.kind, title: intent.title, amount: intent.amount });
    events.push({ type: 'focus_gained', target: 'enemy', amount: intent.amount });
  }
  if (next.player.health === 0) {
    const active = next.roster?.find((entry) => entry.partner_id === next.partner_id);
    if (active) {
      active.health = 0;
      active.fainted = true;
    }
    const replacementAvailable = next.roster?.some((entry) => entry.owned && !entry.fainted && entry.health > 0);
    next.phase = replacementAvailable ? 'partner-selection' : 'defeated';
    events.push({ type: 'encounter_lost', encounter_id: next.enemy.id });
    if (replacementAvailable) events.push({ type: 'partner_switch_required', partner_id: next.partner_id });
    return;
  }
  next.enemy.intent_index = (next.enemy.intent_index + 1) % next.enemy.intent_deck.length;
  next.enemy.intent = clone(next.enemy.intent_deck[next.enemy.intent_index]);
}

function resolvePractice(state, command, definition) {
  const pending = state.pending_action;
  const result = command.payload?.result;
  if (!pending) return failure(state, 'no_pending_action', 'No challenge is pending');
  if (pending.status !== CHALLENGE_STATES.STARTED) return failure(state, 'invalid_challenge_state', 'Challenge has not started');
  if (command.payload?.challenge_id !== pending.id) return failure(state, 'challenge_mismatch', 'Result does not match the pending challenge');
  if (!isChallengeResult(result)) return failure(state, 'invalid_challenge_result', 'Challenge result is invalid');

  const next = clone(state);
  next.pending_action = null;
  if (result.status === 'error') {
    next.ranked = false;
    next.unranked_reasons.push(result.metrics?.reason || 'provider_error');
    return success(next, [{ type: 'challenge_interrupted', challenge_id: pending.id, status: 'error', refunded: true }]);
  }

  const move = definition.cards[pending.card_definition_id];
  const normalizedScore = result.status === 'completed' ? result.score : 0;
  const outcome = selectOutcome(move, normalizedScore);
  const multiplier = outcome.multiplier;
  const firstPass = result.status === 'completed'
    && (result.metrics?.firstTry ?? result.metrics?.first_try ?? ((result.metrics?.wrongNotes || 0) === 0));
  next.practice_attempts.push({
    challenge_id: pending.id,
    attempt_id: result.attempt_id || null,
    status: result.status,
    score: normalizedScore,
    first_pass: Boolean(firstPass),
    kind: pending.request.kind,
    move_id: pending.card_definition_id,
    encounter_id: next.enemy.id,
    provider_version: result.provider_version || null,
    grading_policy_version: pending.prepared?.grading_policy_version || null,
  });
  next.score = computePokemonJourneyScore(next, definition).score;
  next.turn += 1;
  if (move.finisher) {
    next.gym_finisher_used = true;
    next.zones.hand = next.zones.hand.filter((instance) => instance.instance_id !== pending.card_instance_id);
  }

  const events = [{
    type: 'challenge_resolved', challenge_id: pending.id, score: normalizedScore, outcome: outcome.id,
    status: result.status,
  }];
  const focus = next.player.focus;
  const baseDamage = Math.max(0, Math.round((move.damage || 0) * multiplier));
  const attemptedDamage = baseDamage + focus;
  const blocked = Math.min(next.enemy.block, attemptedDamage);
  const damage = Math.max(0, attemptedDamage - blocked);
  next.enemy.block -= blocked;
  next.enemy.health = Math.max(0, next.enemy.health - damage);
  next.player.focus = 0;
  if (focus > 0) events.push({ type: 'focus_spent', amount: focus });
  if (blocked > 0) events.push({ type: 'damage_blocked', target: 'enemy', amount: blocked });
  events.push({ type: 'damage_dealt', target: 'enemy', amount: damage, attempted: attemptedDamage });
  if (move.block) {
    const block = Math.max(0, Math.round(move.block * multiplier));
    next.player.block += block;
    events.push({ type: 'block_gained', target: 'player', amount: block });
  }
  if (move.focus) {
    const gained = Math.max(0, Math.round(move.focus * multiplier));
    next.player.focus += gained;
    events.push({ type: 'focus_gained', target: 'player', amount: gained });
  }

  if (next.enemy.health === 0) {
    next.completed_encounters.push(next.enemy.id);
    const rosterEntry = next.roster?.find((entry) => entry.partner_id === next.partner_id);
    if (rosterEntry) rosterEntry.health = next.player.health;
    events.push({ type: 'encounter_completed', encounter_id: next.enemy.id, encounter_index: next.current_encounter });
    if (next.campaign_stage === 'gym') {
      const gym = definition.journey.gym;
      const currentGymIndex = next.gym_encounter_index ?? 0;
      if (currentGymIndex + 1 < gym.opponents.length) {
        next.phase = 'checkpoint';
        events.push({ type: 'gym_opponent_completed', gym_id: gym.id, gym_index: currentGymIndex });
      } else {
        next.phase = 'chapter-summary';
        next.winner = 'player';
        next.journey_summary = computePokemonJourneyScore(next, definition);
        next.score = next.journey_summary.score;
        const ceremonyId = `badge:${gym.badge?.id || gym.id}`;
        if (!next.completed_ceremony_ids.includes(ceremonyId) && !next.queued_ceremony_ids.includes(ceremonyId)) {
          next.queued_ceremony_ids.push(ceremonyId);
        }
        events.push({ type: 'gym_completed', gym_id: gym.id, badge_id: gym.badge?.id || gym.id, ceremony_id: ceremonyId });
      }
      return success(next, events);
    }
    const routeComplete = next.completed_encounters.length === next.route_plan.length;
    if (routeComplete && definition.journey.gym) {
      next.phase = 'gym-entry';
      next.campaign_stage = 'gym-entry';
      events.push({ type: 'gym_entry_ready', gym_id: definition.journey.gym.id });
    } else if (routeComplete) {
      next.status = 'complete';
      next.phase = 'complete';
      next.winner = 'player';
      next.journey_summary = computePokemonJourneyScore(next, definition);
      next.score = next.journey_summary.score;
      events.push({ type: 'game_ended', winner: 'player', score: next.score, qualified: next.journey_summary.qualified });
    } else if (definition.journey.recruit_after?.includes(next.completed_encounters.length)) {
      const candidates = next.completed_encounters.slice(-2)
        .filter((candidateId) => !next.owned_pokemon_ids.includes(candidateId));
      next.recruitment_candidates = candidates;
      next.phase = candidates.length > 0 ? 'recruitment' : 'checkpoint';
      if (candidates.length > 0) events.push({ type: 'recruitment_ready', candidate_ids: candidates });
      else events.push({ type: 'recruitment_skipped', reason: 'candidates_already_owned' });
    } else {
      next.phase = 'checkpoint';
    }
    return success(next, events);
  }

  resolveEnemyAction(next, events);
  return success(next, events);
}

function continueEncounter(state, definition) {
  if (state.phase === 'chapter-summary') {
    const next = clone(state);
    const ceremonyId = next.queued_ceremony_ids[0];
    next.phase = ceremonyId ? 'ceremony' : 'final-report';
    next.active_ceremony = ceremonyId ? { id: ceremonyId, type: ceremonyId.split(':')[0], subject_id: ceremonyId.split(':')[1] } : null;
    return success(next, [{ type: 'chapter_summary_confirmed' }]);
  }
  if (state.phase === 'ceremony') {
    const next = clone(state);
    const ceremony = next.active_ceremony;
    if (ceremony?.id && !next.completed_ceremony_ids.includes(ceremony.id)) next.completed_ceremony_ids.push(ceremony.id);
    next.queued_ceremony_ids = next.queued_ceremony_ids.filter((id) => id !== ceremony?.id);
    next.active_ceremony = null;
    if (next.campaign_stage === 'gym' && next.winner === 'player') next.phase = 'final-report';
    else next.phase = 'checkpoint';
    return success(next, [{ type: 'ceremony_completed', ceremony_id: ceremony?.id || null }]);
  }
  if (state.phase === 'final-report') {
    const next = clone(state);
    next.status = 'complete';
    next.phase = 'complete';
    return success(next, [{ type: 'game_ended', winner: 'player', score: next.score, qualified: next.journey_summary?.qualified || false }]);
  }
  if (state.phase !== 'checkpoint') return failure(state, 'checkpoint_required', 'No cleared checkpoint is ready');
  const next = clone(state);
  if (next.campaign_stage === 'gym') {
    next.gym_encounter_index = (next.gym_encounter_index ?? 0) + 1;
    next.phase = 'battle';
    next.player.block = 0;
    next.player.focus = 0;
    const gymOpponent = definition.journey.gym.opponents[next.gym_encounter_index];
    next.enemy = makeEnemyFrom(gymOpponent, next.rng_state);
    next.rng_state = next.enemy.rng_state;
    return success(next, [{ type: 'encounter_started', encounter_id: next.enemy.id, gym_index: next.gym_encounter_index }]);
  }
  next.current_encounter += 1;
  next.phase = 'battle';
  next.player.health = next.player.max_health;
  next.player.block = 0;
  next.player.focus = 0;
  if (next.completed_encounters.length === 1) next.zones.hand = moveInstances(definition, next.partner_id);
  next.enemy = makeEnemyFrom(next.route_plan[next.current_encounter], next.rng_state);
  next.rng_state = next.enemy.rng_state;
  return success(next, [{ type: 'encounter_started', encounter_id: next.enemy.id, encounter_index: next.current_encounter }]);
}

function selectRecruit(state, command, definition) {
  if (state.phase !== 'recruitment') return failure(state, 'recruitment_unavailable', 'No recruitment decision is pending');
  const candidateIds = state.recruitment_candidates || state.completed_encounters.slice(-2);
  const recruitId = command.payload?.recruit_id;
  if (!candidateIds.includes(recruitId)) return failure(state, 'invalid_recruit', 'Choose one of the defeated candidates');
  const next = clone(state);
  next.recruitment_choices.push({ after_encounter: next.completed_encounters.length, recruit_id: recruitId });
  if (!next.owned_pokemon_ids.includes(recruitId)) next.owned_pokemon_ids.push(recruitId);
  next.recruitment_candidates = [];
  const ceremonyId = `catch:${recruitId}`;
  if (!next.completed_ceremony_ids.includes(ceremonyId) && !next.queued_ceremony_ids.includes(ceremonyId)) {
    next.queued_ceremony_ids.push(ceremonyId);
  }
  next.phase = 'ceremony';
  next.active_ceremony = { id: ceremonyId, type: 'catch', subject_id: recruitId };
  return success(next, [{ type: 'recruit_selected', recruit_id: recruitId, ceremony_id: ceremonyId }]);
}

function selectPartner(state, command, definition) {
  if (!['partner-selection', 'defeated'].includes(state.phase)) {
    return failure(state, 'partner_selection_unavailable', 'A partner switch is not currently required');
  }
  const partnerId = command.payload?.partner_id;
  const partner = partnerFor(definition, partnerId);
  const rosterEntry = state.roster?.find((entry) => entry.partner_id === partnerId);
  if (!partner || !rosterEntry?.owned || rosterEntry.fainted || rosterEntry.health <= 0) {
    return failure(state, 'partner_unavailable', 'Choose an owned partner that can still battle');
  }
  const next = clone(state);
  next.partner_id = partnerId;
  next.player.name = partner.name;
  next.player.health = rosterEntry.health;
  next.player.max_health = rosterEntry.max_health;
  next.zones.hand = moveInstances(definition, partnerId);
  next.phase = 'battle';
  return success(next, [{ type: 'partner_selected', partner_id: partnerId }]);
}

function startGym(state, definition) {
  if (state.phase !== 'gym-entry' || !definition.journey.gym) {
    return failure(state, 'gym_unavailable', 'The gym is not ready');
  }
  const next = clone(state);
  next.phase = 'battle';
  next.campaign_stage = 'gym';
  next.gym_encounter_index = 0;
  next.player.health = next.player.max_health;
  next.player.block = 0;
  next.player.focus = 0;
  for (const entry of next.roster || []) {
    if (entry.owned) {
      entry.health = entry.max_health;
      entry.fainted = false;
    }
  }
  const gymOpponent = definition.journey.gym.opponents[0];
  next.enemy = makeEnemyFrom(gymOpponent, next.rng_state);
  if (definition.cards['stadium-finale']) {
    next.zones.hand.push({ instance_id: 'stadium-finale:1', definition_id: 'stadium-finale' });
  }
  next.rng_state = next.enemy.rng_state;
  return success(next, [{ type: 'gym_started', gym_id: definition.journey.gym.id, encounter_id: gymOpponent.id }]);
}

function suspend(state, command) {
  if (state.status !== 'active') return failure(state, 'session_terminal', 'The journey is already terminal');
  const next = clone(state);
  const pending = next.pending_action;
  next.pending_action = null;
  next.suspended_at = command.payload?.at || null;
  const events = [];
  if (pending) events.push({ type: 'challenge_interrupted', challenge_id: pending.id, status: 'aborted', reason: 'session_suspended', refunded: true });
  events.push({ type: 'session_suspended', reason: command.payload?.reason || 'player_saved' });
  return success(next, events);
}

function retryEncounter(state, definition) {
  if (state.phase !== 'defeated') return failure(state, 'retry_unavailable', 'The current encounter is not defeated');
  const next = clone(state);
  next.phase = 'battle';
  next.player.health = next.player.max_health;
  next.player.block = 0;
  next.player.focus = 0;
  const opponent = next.campaign_stage === 'gym'
    ? definition.journey.gym.opponents[next.gym_encounter_index || 0]
    : next.route_plan[next.current_encounter];
  next.enemy = makeEnemyFrom(opponent, next.rng_state);
  next.rng_state = next.enemy.rng_state;
  return success(next, [{ type: 'encounter_retried', encounter_id: next.enemy.id, encounter_index: next.current_encounter }]);
}

function abortPending(state, command) {
  if (!state.pending_action) return failure(state, 'no_pending_action', 'No challenge is pending');
  if (command.payload?.challenge_id && command.payload.challenge_id !== state.pending_action.id) {
    return failure(state, 'challenge_mismatch', 'Abort does not match the pending challenge');
  }
  const next = clone(state);
  const challengeId = next.pending_action.id;
  next.pending_action = null;
  next.ranked = false;
  next.unranked_reasons.push(String(command.payload?.reason || 'infrastructure_abort'));
  return success(next, [{ type: 'action_aborted', challenge_id: challengeId, reason: command.payload?.reason || 'infrastructure_abort', refunded: true }]);
}

function abandon(state, command) {
  if (state.status !== 'active') return failure(state, 'session_terminal', 'The journey is already terminal');
  const next = clone(state);
  next.status = 'abandoned';
  next.phase = 'abandoned';
  const pending = next.pending_action;
  next.pending_action = null;
  const reason = String(command.payload?.reason || 'player_closed');
  const events = pending ? [{ type: 'challenge_interrupted', challenge_id: pending.id, status: 'aborted', reason }] : [];
  events.push({ type: 'session_abandoned', reason });
  return success(next, events);
}

export function derivePokemonJourneyYield(state) {
  if (state.status !== 'active') return { type: 'terminal', winner: state.winner, status: state.status };
  if (state.pending_action) {
    return {
      type: 'challenge', lifecycle: state.pending_action.status,
      request: clone(state.pending_action.request), prepared: clone(state.pending_action.prepared),
    };
  }
  if (state.phase === 'checkpoint') return { type: 'checkpoint', encounter_index: state.current_encounter };
  if (state.phase === 'recruitment') return { type: 'interstitial', kind: 'recruitment' };
  if (state.phase === 'partner-selection') return { type: 'interstitial', kind: 'partner-selection' };
  if (state.phase === 'gym-entry') return { type: 'interstitial', kind: 'gym-entry' };
  if (state.phase === 'chapter-summary') return { type: 'interstitial', kind: 'chapter-summary' };
  if (state.phase === 'ceremony') return { type: 'ceremony', ceremony: clone(state.active_ceremony) };
  if (state.phase === 'final-report') return { type: 'interstitial', kind: 'research-report' };
  if (state.phase === 'defeated') return { type: 'retry', encounter_index: state.current_encounter };
  return { type: 'player_choice' };
}

export function derivePokemonJourneyInteraction(state, definition, viewerId = null) {
  const legalCommands = [];
  if (state.status === 'active' && !state.pending_action) {
    if (state.phase === 'battle') {
      for (const instance of state.zones.hand) {
        const move = definition.cards[instance.definition_id];
        if (!move.signature || state.completed_encounters.length > 0) {
          legalCommands.push({ type: COMMAND_TYPES.CHOOSE_ACTION, payload: { card_instance_id: instance.instance_id } });
        }
      }
    } else if (['checkpoint', 'chapter-summary', 'ceremony', 'final-report'].includes(state.phase)) {
      legalCommands.push({ type: COMMAND_TYPES.CONTINUE_ENCOUNTER, payload: {} });
    } else if (state.phase === 'defeated') {
      legalCommands.push({ type: COMMAND_TYPES.RETRY_ENCOUNTER, payload: {} });
    } else if (state.phase === 'recruitment') {
      for (const recruitId of state.recruitment_candidates || state.completed_encounters.slice(-2)) {
        legalCommands.push({ type: COMMAND_TYPES.SELECT_RECRUIT, payload: { recruit_id: recruitId } });
      }
    } else if (state.phase === 'partner-selection') {
      for (const entry of state.roster || []) {
        if (entry.owned && !entry.fainted && entry.health > 0) {
          legalCommands.push({ type: COMMAND_TYPES.SELECT_PARTNER, payload: { partner_id: entry.partner_id } });
        }
      }
    } else if (state.phase === 'gym-entry') {
      legalCommands.push({ type: COMMAND_TYPES.START_GYM, payload: {} });
    }
  }
  return { viewer_id: viewerId, legal_commands: legalCommands, yield: derivePokemonJourneyYield(state) };
}

export function transitionPokemonJourney(state, command, definition) {
  switch (command.type) {
    case COMMAND_TYPES.CHOOSE_ACTION: return chooseMove(state, command, definition);
    case COMMAND_TYPES.PREPARE_CHALLENGE: return prepareChallenge(state, command);
    case COMMAND_TYPES.START_CHALLENGE: return startChallenge(state, command);
    case COMMAND_TYPES.SUBMIT_CHALLENGE_RESULT: return resolvePractice(state, command, definition);
    case COMMAND_TYPES.CONTINUE_ENCOUNTER: return continueEncounter(state, definition);
    case COMMAND_TYPES.RETRY_ENCOUNTER: return retryEncounter(state, definition);
    case COMMAND_TYPES.SELECT_PARTNER: return selectPartner(state, command, definition);
    case COMMAND_TYPES.SELECT_RECRUIT: return selectRecruit(state, command, definition);
    case COMMAND_TYPES.START_GYM: return startGym(state, definition);
    case COMMAND_TYPES.SUSPEND_SESSION: return suspend(state, command);
    case COMMAND_TYPES.ABORT_PENDING_ACTION: return abortPending(state, command);
    case COMMAND_TYPES.ABANDON_SESSION: return abandon(state, command);
    default: return failure(state, 'unsupported_command', `Unsupported journey command: ${command.type}`);
  }
}
