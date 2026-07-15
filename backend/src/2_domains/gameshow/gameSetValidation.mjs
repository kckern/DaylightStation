/**
 * Pure validation + normalization for game-show content sets
 * (data/content/games/<game>/<set-id>.yml). No I/O — callers load YAML
 * and pass the parsed object.
 *
 * Normalized shape (returned as `set` when valid):
 *   { id, title, description, rounds: [{ name, mode, multiplier,
 *     timer_seconds|null, penalize_wrong, categories: [{ name,
 *     clues: [{ value, clue, answer, media|null, daily_double }] }] }],
 *     final: { category, clue, answer, media|null } | null }
 */

const MODES = ['hosted', 'self', 'turns'];
const MEDIA_TYPES = ['image', 'audio', 'video'];

function normalizeMedia(media, path, errors) {
  if (media == null) return null;
  if (typeof media !== 'object') {
    errors.push(`${path}.media must be an object`);
    return null;
  }
  if (!MEDIA_TYPES.includes(media.type)) {
    errors.push(`${path}.media.type must be one of ${MEDIA_TYPES.join('|')} (got "${media.type}")`);
    return null;
  }
  if (typeof media.src !== 'string' || !media.src) {
    errors.push(`${path}.media.src is required`);
    return null;
  }
  return { type: media.type, src: media.src };
}

function normalizeClue(clue, path, errors) {
  if (clue == null || typeof clue !== 'object') {
    errors.push(`${path} must be an object`);
    return null;
  }
  if (typeof clue.value !== 'number' || clue.value <= 0) {
    errors.push(`${path}.value must be a positive number`);
  }
  if (typeof clue.clue !== 'string' || !clue.clue) {
    errors.push(`${path}.clue is required`);
  }
  if (typeof clue.answer !== 'string' || !clue.answer) {
    errors.push(`${path}.answer is required`);
  }
  return {
    value: clue.value,
    clue: clue.clue,
    answer: clue.answer,
    media: normalizeMedia(clue.media, path, errors),
    daily_double: clue.daily_double === true,
  };
}

export function validateGameSet(raw) {
  const errors = [];
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['game set must be a mapping/object'], set: null };
  }
  if (typeof raw.id !== 'string' || !raw.id) errors.push('id is required');
  if (typeof raw.title !== 'string' || !raw.title) errors.push('title is required');
  if (!Array.isArray(raw.rounds) || raw.rounds.length === 0) errors.push('rounds must be a non-empty array');

  const rounds = (Array.isArray(raw.rounds) ? raw.rounds : []).map((round, r) => {
    const rPath = `rounds[${r}]`;
    if (round == null || typeof round !== 'object') {
      errors.push(`${rPath} must be an object`);
      return null;
    }
    const mode = round.mode ?? 'hosted';
    if (!MODES.includes(mode)) {
      errors.push(`${rPath}.mode must be one of ${MODES.join('|')} (got "${mode}")`);
    }
    if (!Array.isArray(round.categories) || round.categories.length === 0) {
      errors.push(`${rPath}.categories must be a non-empty array`);
    }
    const categories = (Array.isArray(round.categories) ? round.categories : []).map((cat, c) => {
      const cPath = `${rPath}.categories[${c}]`;
      if (cat == null || typeof cat !== 'object' || typeof cat.name !== 'string' || !cat.name) {
        errors.push(`${cPath}.name is required`);
        return null;
      }
      if (!Array.isArray(cat.clues) || cat.clues.length === 0) {
        errors.push(`${cPath}.clues must be a non-empty array`);
        return { name: cat.name, clues: [] };
      }
      return {
        name: cat.name,
        clues: cat.clues.map((clue, i) => normalizeClue(clue, `${cPath}.clues[${i}]`, errors)),
      };
    });
    return {
      name: typeof round.name === 'string' && round.name ? round.name : `Round ${r + 1}`,
      mode,
      multiplier: typeof round.multiplier === 'number' && round.multiplier > 0 ? round.multiplier : 1,
      timer_seconds: typeof round.timer_seconds === 'number' ? round.timer_seconds : null,
      penalize_wrong: round.penalize_wrong !== false,
      categories,
    };
  });

  let final = null;
  if (raw.final != null) {
    const f = raw.final;
    if (typeof f !== 'object' || typeof f.category !== 'string' || typeof f.clue !== 'string' || typeof f.answer !== 'string') {
      errors.push('final requires category, clue, and answer strings');
    } else {
      final = { category: f.category, clue: f.clue, answer: f.answer, media: normalizeMedia(f.media, 'final', errors) };
    }
  }

  if (errors.length > 0) return { valid: false, errors, set: null };
  return {
    valid: true,
    errors: [],
    set: {
      id: raw.id,
      title: raw.title,
      description: typeof raw.description === 'string' ? raw.description : '',
      rounds,
      final,
    },
  };
}
