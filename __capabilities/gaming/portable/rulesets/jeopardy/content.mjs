import { validateJeopardyScoringMetadata } from './scoringPolicy.mjs';
import { normalizeLearn, validateLearn } from "../../mechanics/learn.mjs";
/**
 * Pure validation + normalization for Jeopardy content packs.
 * (data/content/games/<game>/<set-id>.yml). No I/O — callers load YAML
 * and pass the parsed object.
 *
 * Normalized shape (returned as `set` when valid):
 *   { id, title, description, open_book, rounds: [{ name, mode, multiplier,
 *     timer_seconds|null, penalize_wrong, categories: [{ name,
 *     clues: [{ value, clue, answer, scripture_reference|null, media|null, learn|null, daily_double }] }] }],
 *     final: { category, clue, answer, scripture_reference|null, media|null, learn|null } | null }
 */

const MODES = ['hosted', 'self', 'turns'];
const MEDIA_TYPES = ['image', 'audio', 'video'];

/** Shared metadata rules for authored packs and live definitions.
 * Null is the normalized legacy sentinel, equivalent to an absent reference.
 */
export function validateJeopardyScriptureMetadata(definition) {
  const errors = [];
  if (definition == null || typeof definition !== 'object') return errors;
  if (definition.open_book !== undefined && typeof definition.open_book !== 'boolean') {
    errors.push('open_book must be a boolean');
  }
  const check = (clue, path) => {
    const reference = clue?.scripture_reference;
    if ((reference != null || definition.open_book === true) &&
        (typeof reference !== 'string' || !reference.trim())) {
      errors.push(`${path}.scripture_reference must be a nonblank string`);
    }
  };
  if (Array.isArray(definition.rounds)) definition.rounds.forEach((round, r) => {
    if (Array.isArray(round?.categories)) round.categories.forEach((category, c) => {
      if (Array.isArray(category?.clues)) category.clues.forEach((clue, i) => {
        check(clue, `rounds[${r}].categories[${c}].clues[${i}]`);
      });
    });
  });
  if (definition.final != null) check(definition.final, 'final');
  return errors;
}

const normalizeReference = (clue) => typeof clue.scripture_reference === 'string' ? clue.scripture_reference.trim() : null;

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
  if (clue.little_kids != null && typeof clue.little_kids !== 'boolean') errors.push(`${path}.little_kids must be a boolean`);
  errors.push(...validateLearn(clue.learn, path));
  return {
    ...(clue.little_kids === true ? { little_kids: true } : {}),
    value: clue.value,
    clue: clue.clue,
    answer: clue.answer,
    scripture_reference: normalizeReference(clue),
    media: normalizeMedia(clue.media, path, errors),
    learn: normalizeLearn(clue.learn),
    daily_double: clue.daily_double === true,
  };
}

export function validateGameSet(raw) {
  const errors = [];
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['game set must be a mapping/object'], set: null };
  }
  errors.push(...validateJeopardyScriptureMetadata(raw), ...validateJeopardyScoringMetadata(raw));
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
      ...(Object.hasOwn(round, 'daily_double_penalize_wrong') ? { daily_double_penalize_wrong: round.daily_double_penalize_wrong } : {}),
      categories,
    };
  });

  let final = null;
  if (raw.final != null) {
    const f = raw.final;
    if (typeof f !== 'object' || typeof f.category !== 'string' || typeof f.clue !== 'string' || typeof f.answer !== 'string') {
      errors.push('final requires category, clue, and answer strings');
    } else {
      errors.push(...validateLearn(f.learn, 'final'));
      final = { scripture_reference: normalizeReference(f), category: f.category, clue: f.clue, answer: f.answer, media: normalizeMedia(f.media, 'final', errors), learn: normalizeLearn(f.learn) };
    }
  }

  if (errors.length > 0) return { valid: false, errors, set: null };
  return {
    valid: true,
    errors: [],
    set: {
      open_book: raw.open_book === true,
      id: raw.id,
      title: raw.title,
      description: typeof raw.description === 'string' ? raw.description : '',
      rounds,
      final,
    },
  };
}
