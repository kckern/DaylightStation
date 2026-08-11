import { GAMING_SCHEMA_VERSION } from './contracts.mjs';

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const JOURNEY_ID = 'pokemon-practice-journey-v1';
const POKEMON_ASSET_FACING = new Set(['left', 'right', 'front']);

function validateJourneyDefinition(definition, errors) {
  const journey = definition.journey;
  if (!journey || typeof journey !== 'object') {
    errors.push('journey is required');
    return;
  }
  if (!Number.isInteger(journey.version) || journey.version < 1) errors.push('journey.version must be a positive integer');
  if (!Number.isInteger(journey.score_version) || journey.score_version < 1) errors.push('journey.score_version must be a positive integer');
  if (!(journey.player_health > 0)) errors.push('journey.player_health must be positive');
  if (!Array.isArray(journey.partners) || journey.partners.length !== 3) errors.push('journey.partners must contain exactly three partners');
  if (!Array.isArray(journey.opponents) || journey.opponents.length !== 3) errors.push('journey.opponents must contain exactly three opponents');

  const cards = definition.cards;
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) errors.push('cards must be an object');
  for (const partner of journey.partners || []) {
    if (!SAFE_ID.test(String(partner?.id || ''))) errors.push('journey partner id is invalid');
    if (typeof partner?.name !== 'string' || partner.name.trim() === '') errors.push(`journey partner ${partner?.id || '?'} requires a name`);
    if (!POKEMON_ASSET_FACING.has(partner?.asset_facing)) errors.push(`journey partner ${partner?.id || '?'} asset_facing is invalid`);
    if (!Array.isArray(partner?.move_ids) || partner.move_ids.length !== 4) {
      errors.push(`journey partner ${partner?.id || '?'} must declare four moves`);
    }
    for (const moveId of partner?.move_ids || []) {
      if (!cards?.[moveId]) errors.push(`journey partner ${partner?.id || '?'} references unknown move: ${moveId}`);
    }
  }
  for (const opponent of journey.opponents || []) {
    if (!SAFE_ID.test(String(opponent?.id || ''))) errors.push('journey opponent id is invalid');
    if (!POKEMON_ASSET_FACING.has(opponent?.asset_facing)) errors.push(`journey opponent ${opponent?.id || '?'} asset_facing is invalid`);
    if (!(opponent?.health > 0)) errors.push(`journey opponent ${opponent?.id || '?'} health must be positive`);
    if (!Array.isArray(opponent?.intents) || opponent.intents.length < 2) {
      errors.push(`journey opponent ${opponent?.id || '?'} must contain at least two intents`);
    }
    for (const intent of opponent?.intents || []) {
      if (!SAFE_ID.test(String(intent?.id || ''))) errors.push(`journey opponent ${opponent?.id || '?'} intent id is invalid`);
      if (!['attack', 'defend', 'charge'].includes(intent?.kind)) errors.push(`journey intent ${intent?.id || '?'} kind is invalid`);
      if (!(intent?.amount > 0)) errors.push(`journey intent ${intent?.id || '?'} amount must be positive`);
    }
  }
  const referencedMoves = new Set((journey.partners || []).flatMap((partner) => partner.move_ids || []));
  for (const moveId of referencedMoves) {
    const move = cards?.[moveId];
    if (!move) continue;
    if (!(move.damage >= 0)) errors.push(`journey move ${moveId} damage must be non-negative`);
    if (move.block !== undefined && !(move.block > 0)) errors.push(`journey move ${moveId} block must be positive`);
    if (move.focus !== undefined && !(move.focus > 0)) errors.push(`journey move ${moveId} focus must be positive`);
    if (typeof move.challenge?.domain !== 'string' || typeof move.challenge?.kind !== 'string') {
      errors.push(`journey move ${moveId} must declare a challenge domain and kind`);
    } else if (!['scale', 'chord', 'arpeggio', 'timed-pattern'].includes(move.challenge.kind)) {
      errors.push(`journey move ${moveId} has unsupported practice kind: ${move.challenge.kind}`);
    }
    if (!Array.isArray(move.outcomes) || move.outcomes.length !== 4 || move.outcomes.at(-1)?.min_score !== 0) {
      errors.push(`journey move ${moveId} must define four outcomes ending at min_score 0`);
    } else {
      for (let index = 0; index < move.outcomes.length; index += 1) {
        const threshold = move.outcomes[index]?.min_score;
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) errors.push(`journey move ${moveId} has invalid outcome threshold`);
        if (index > 0 && threshold >= move.outcomes[index - 1].min_score) errors.push(`journey move ${moveId} outcomes must be strictly descending`);
      }
    }
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function validateDefinition(definition) {
  const errors = [];
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return { valid: false, errors: ['definition must be an object'] };
  }
  if (definition.schema_version !== GAMING_SCHEMA_VERSION) errors.push(`schema_version must be ${GAMING_SCHEMA_VERSION}`);
  if (!SAFE_ID.test(String(definition.game_id || ''))) errors.push('game_id is invalid');
  const legacyCardBattle = definition.view_id === 'card-battle-v1' && definition.ruleset === 'card-battle-v1';
  const pokemonJourney = definition.view_id === JOURNEY_ID && definition.ruleset === JOURNEY_ID;
  if (!legacyCardBattle && !pokemonJourney) errors.push('view_id and ruleset must name a supported matching game contract');
  if (pokemonJourney) {
    validateJourneyDefinition(definition, errors);
    return { valid: errors.length === 0, errors };
  }
  if (!legacyCardBattle) return { valid: errors.length === 0, errors };

  const battle = definition.card_battle;
  if (!battle || typeof battle !== 'object') errors.push('card_battle is required');
  if (!(battle?.player?.health > 0)) errors.push('card_battle.player.health must be positive');
  if (!(battle?.player?.max_energy > 0)) errors.push('card_battle.player.max_energy must be positive');
  if (!(battle?.enemy?.health > 0)) errors.push('card_battle.enemy.health must be positive');
  const tactical = battle?.turn_mode === 'tactical';
  if (battle?.turn_mode && !['single-card', 'tactical'].includes(battle.turn_mode)) {
    errors.push('card_battle.turn_mode must be single-card or tactical');
  }
  if (tactical) {
    if (!Number.isInteger(battle?.hand_size) || battle.hand_size < 2) errors.push('tactical card_battle.hand_size must be at least 2');
    if (!Array.isArray(battle?.enemy?.intents) || battle.enemy.intents.length < 2) {
      errors.push('tactical card_battle.enemy.intents must contain at least two intents');
    } else {
      for (const intent of battle.enemy.intents) {
        if (!SAFE_ID.test(String(intent?.id || ''))) errors.push('enemy intent id is invalid');
        if (!['attack', 'defend', 'charge'].includes(intent?.kind)) errors.push(`enemy intent ${intent?.id || '?'} has invalid kind`);
        if (!(intent?.amount > 0)) errors.push(`enemy intent ${intent?.id || '?'} amount must be positive`);
      }
    }
    for (const upgrade of battle?.upgrades || []) {
      if (!SAFE_ID.test(String(upgrade?.id || ''))) errors.push('upgrade id is invalid');
      if (typeof upgrade?.title !== 'string' || upgrade.title.trim() === '') errors.push(`upgrade ${upgrade?.id || '?'} requires a title`);
      if (typeof upgrade?.description !== 'string' || upgrade.description.trim() === '') errors.push(`upgrade ${upgrade?.id || '?'} requires a description`);
      if (!(upgrade?.effect?.max_health > 0) && !(upgrade?.effect?.starting_focus > 0)) {
        errors.push(`upgrade ${upgrade?.id || '?'} requires a supported effect`);
      }
    }
  } else if (!(battle?.enemy?.attack >= 0)) {
    errors.push('card_battle.enemy.attack must be non-negative');
  }
  if (!Array.isArray(battle?.deck) || battle.deck.length === 0) errors.push('card_battle.deck must not be empty');

  const challengePools = battle?.challenge_pools || {};
  for (const [poolId, pool] of Object.entries(challengePools)) {
    if (!SAFE_ID.test(poolId)) errors.push(`challenge pool id is invalid: ${poolId}`);
    if (!Array.isArray(pool?.prompts) || pool.prompts.length === 0) errors.push(`challenge pool ${poolId} must contain prompts`);
  }

  const cards = definition.cards;
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) errors.push('cards must be an object');
  for (const cardId of battle?.deck || []) {
    const card = cards?.[cardId];
    if (!card) {
      errors.push(`deck references unknown card: ${cardId}`);
      continue;
    }
    const cardType = card.type || 'attack';
    if (!(card.cost >= 0)) errors.push(`card ${cardId} has invalid cost`);
    if (!['attack', 'guard', 'focus'].includes(cardType)) errors.push(`card ${cardId} has invalid type`);
    if (cardType === 'attack' && !(card.damage >= 0)) errors.push(`card ${cardId} has invalid damage`);
    if (cardType === 'guard' && !(card.block > 0)) errors.push(`card ${cardId} has invalid block`);
    if (cardType === 'focus' && !(card.focus > 0)) errors.push(`card ${cardId} has invalid focus`);
    const challenge = card.challenge;
    if (typeof challenge?.domain !== 'string' || challenge.domain.trim() === ''
      || typeof challenge?.kind !== 'string' || challenge.kind.trim() === '') {
      errors.push(`card ${cardId} must declare a challenge domain and kind`);
    } else if (challenge.pool) {
      const pool = challengePools[challenge.pool];
      if (!pool) errors.push(`card ${cardId} references unknown challenge pool: ${challenge.pool}`);
      for (const prompt of pool?.prompts || []) {
        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) errors.push(`challenge pool ${challenge.pool} has an invalid prompt`);
      }
    }
    if (challenge?.requirements !== undefined
      && (!challenge.requirements || typeof challenge.requirements !== 'object' || Array.isArray(challenge.requirements))) {
      errors.push(`card ${cardId} challenge requirements must be an object`);
    }
    if (challenge?.timeout_ms !== undefined && (!Number.isInteger(challenge.timeout_ms) || challenge.timeout_ms < 1000)) {
      errors.push(`card ${cardId} challenge timeout_ms must be at least 1000`);
    }
    const outcomes = card.outcomes;
    if (!Array.isArray(outcomes) || outcomes.length === 0 || outcomes.at(-1)?.min_score !== 0) {
      errors.push(`card ${cardId} outcomes must end at min_score 0`);
    } else {
      for (let i = 0; i < outcomes.length; i += 1) {
        const threshold = outcomes[i]?.min_score;
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) errors.push(`card ${cardId} has invalid outcome threshold`);
        if (i > 0 && threshold >= outcomes[i - 1].min_score) errors.push(`card ${cardId} outcomes must be strictly descending`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertDefinition(definition) {
  const result = validateDefinition(definition);
  if (!result.valid) throw new Error(`Invalid gaming definition: ${result.errors.join('; ')}`);
  return canonicalize(definition);
}
