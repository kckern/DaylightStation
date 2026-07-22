/**
 * Pure validation + normalisation of a question bank (spec §4). No I/O.
 * Fail-closed: audience defaults to 'assigned' so an omission never exposes a
 * bank to guests.
 *
 * Banks are hand-authored YAML consumed directly by a rendering UI, so every
 * leaf value a consumer displays (choices, answer, accept, matching
 * left/right) must be checked as a non-empty string here — an object or an
 * empty/whitespace value that slips through is a live UI crash or a silently
 * unanswerable question.
 */
const ITEM_TYPES = new Set(['multiple_choice', 'short_answer', 'cloze', 'matching']);
const AUDIENCES = new Set(['generic', 'assigned']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

export function validateQuestionBank(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['bank must be a mapping'] };
  }
  if (!isNonEmptyString(raw.id)) errors.push('id is required');
  if (!isNonEmptyString(raw.title)) errors.push('title is required');
  const audience = raw.audience === undefined || raw.audience === null ? 'assigned' : raw.audience;
  if (!AUDIENCES.has(audience)) errors.push(`audience must be generic|assigned, got: ${raw.audience}`);
  let topics = [];
  if (raw.topics !== undefined && raw.topics !== null) {
    if (!Array.isArray(raw.topics) || !raw.topics.every((t) => typeof t === 'string')) {
      errors.push('topics must be an array of strings');
    } else {
      topics = raw.topics;
    }
  }
  // spec §5: unit/readalong backlinks are optional; when present, non-empty strings.
  // No further validation — a bank does not know whether the id/path resolves.
  let unit;
  if (raw.unit !== undefined && raw.unit !== null) {
    if (!isNonEmptyString(raw.unit)) errors.push('unit must be a non-empty string');
    else unit = raw.unit;
  }
  let readalong;
  if (raw.readalong !== undefined && raw.readalong !== null) {
    if (!isNonEmptyString(raw.readalong)) errors.push('readalong must be a non-empty string');
    else readalong = raw.readalong;
  }
  // Subject-wall shelf. Deliberately NOT checked against the six known
  // subjects: the frontend routes an unknown shelf to the Library, so a typo
  // costs a misplaced tile, whereas rejecting here would cost the whole quiz.
  let subject;
  if (raw.subject !== undefined && raw.subject !== null) {
    if (!isNonEmptyString(raw.subject)) errors.push('subject must be a non-empty string');
    else subject = raw.subject;
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    errors.push('items must be a non-empty array');
    return { ok: false, errors };
  }
  const seen = new Set();
  raw.items.forEach((item, i) => {
    const at = `items[${i}]`;
    if (!item || typeof item !== 'object') { errors.push(`${at}: must be a mapping`); return; }
    if (!item.id || typeof item.id !== 'string') errors.push(`${at}: id is required`);
    else if (seen.has(item.id)) errors.push(`${at}: duplicate id "${item.id}"`);
    else seen.add(item.id);
    if (!ITEM_TYPES.has(item.type)) { errors.push(`${at}: unknown type "${item.type}"`); return; }
    if (!isNonEmptyString(item.prompt)) errors.push(`${at}: prompt is required`);
    if (item.type === 'multiple_choice') {
      if (!Array.isArray(item.choices) || item.choices.length < 2) {
        errors.push(`${at}: choices must have >= 2 entries`);
      } else {
        if (!item.choices.every(isNonEmptyString)) errors.push(`${at}: choices must be non-empty strings`);
        if (new Set(item.choices).size !== item.choices.length) errors.push(`${at}: choices must be unique`);
        if (!isNonEmptyString(item.answer)) errors.push(`${at}: answer must be a non-empty string`);
        else if (!item.choices.includes(item.answer)) errors.push(`${at}: answer must appear in choices`);
      }
    }
    if (item.type === 'short_answer' || item.type === 'cloze') {
      if (!isNonEmptyString(item.answer)) errors.push(`${at}: answer is required`);
      if (item.accept !== undefined) {
        if (!Array.isArray(item.accept)) errors.push(`${at}: accept must be an array`);
        else if (!item.accept.every(isNonEmptyString)) errors.push(`${at}: accept entries must be non-empty strings`);
      }
    }
    if (item.type === 'cloze') {
      const blanks = (String(item.prompt).match(/_{3,}/g) || []).length;
      if (blanks !== 1) errors.push(`${at}: cloze prompt must contain the blank marker ___ exactly once (found ${blanks})`);
    }
    if (item.type === 'matching') {
      if (!Array.isArray(item.pairs) || item.pairs.length < 2) {
        errors.push(`${at}: pairs must have >= 2 entries`);
      } else {
        const lefts = item.pairs.map((p) => p?.left); const rights = item.pairs.map((p) => p?.right);
        if (lefts.some((v) => !isNonEmptyString(v)) || rights.some((v) => !isNonEmptyString(v))) {
          errors.push(`${at}: every pair needs left and right`);
        }
        if (new Set(lefts).size !== lefts.length) errors.push(`${at}: left values must be unique`);
        if (new Set(rights).size !== rights.length) errors.push(`${at}: right values must be unique`);
      }
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, bank: { id: raw.id, title: raw.title, audience, topics, subject, items: raw.items, unit, readalong } };
}
