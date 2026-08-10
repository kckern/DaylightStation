import { GAMING_SCHEMA_VERSION } from './contracts.mjs';

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;

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
  if (definition.view_id !== 'card-battle-v1') errors.push('first-wave view_id must be card-battle-v1');
  if (definition.ruleset !== 'card-battle-v1') errors.push('first-wave ruleset must be card-battle-v1');

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
    if (challenge?.domain !== 'piano' || !['chord', 'scale'].includes(challenge?.kind)) {
      errors.push(`card ${cardId} must use a supported piano challenge`);
    } else if (challenge.pool) {
      const pool = challengePools[challenge.pool];
      if (!pool) errors.push(`card ${cardId} references unknown challenge pool: ${challenge.pool}`);
      for (const prompt of pool?.prompts || []) {
        if (challenge.kind === 'scale') {
          const notes = prompt?.expected_midi;
          if (!Array.isArray(notes) || notes.length < 2) errors.push(`challenge pool ${challenge.pool} has an invalid scale prompt`);
          if (typeof prompt?.abc !== 'string' || prompt.abc.trim() === '') errors.push(`challenge pool ${challenge.pool} scale prompt requires abc`);
          if (prompt?.max_mistakes !== undefined && (!Number.isInteger(prompt.max_mistakes) || prompt.max_mistakes < 1)) {
            errors.push(`challenge pool ${challenge.pool} max_mistakes must be a positive integer`);
          }
        } else if (!Array.isArray(prompt?.pitch_classes) || prompt.pitch_classes.length === 0) {
          errors.push(`challenge pool ${challenge.pool} has an invalid chord prompt`);
        }
      }
    } else if (challenge.kind === 'chord') {
      if (!Array.isArray(challenge.prompt?.pitch_classes) || challenge.prompt.pitch_classes.length === 0) {
        errors.push(`card ${cardId} requires prompt.pitch_classes`);
      }
    } else if (challenge.kind === 'scale') {
      const notes = challenge.prompt?.expected_midi;
      if (!Array.isArray(notes) || notes.length < 2 || notes.some((note) => !Number.isInteger(note) || note < 0 || note > 127)) {
        errors.push(`card ${cardId} requires prompt.expected_midi with at least two MIDI notes`);
      }
      if (typeof challenge.prompt?.abc !== 'string' || challenge.prompt.abc.trim() === '') {
        errors.push(`card ${cardId} requires prompt.abc staff notation`);
      }
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
