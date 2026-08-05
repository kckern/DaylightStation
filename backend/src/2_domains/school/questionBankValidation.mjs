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
const ITEM_TYPES = new Set(['multiple_choice', 'short_answer', 'cloze', 'matching', 'region_click', 'asset_choice', 'multi_select']);
const AUDIENCES = new Set(['generic', 'assigned']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isImageSpec = (v) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.values(v).every((x) => isNonEmptyString(x));
const CONCEPT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  let concepts = [];
  const conceptIds = new Set();
  if (raw.concepts !== undefined && raw.concepts !== null) {
    if (!Array.isArray(raw.concepts) || raw.concepts.length === 0) {
      errors.push('concepts must be a non-empty array when present');
    } else {
      raw.concepts.forEach((concept, index) => {
        const at = `concepts[${index}]`;
        if (!concept || typeof concept !== 'object' || Array.isArray(concept)) {
          errors.push(`${at}: must be a mapping`); return;
        }
        if (!CONCEPT_ID.test(concept.conceptId || '')) errors.push(`${at}: conceptId must be a lowercase identifier`);
        else if (conceptIds.has(concept.conceptId)) errors.push(`${at}: duplicate conceptId "${concept.conceptId}"`);
        else conceptIds.add(concept.conceptId);
        if (!isNonEmptyString(concept.title)) errors.push(`${at}: title is required`);
        if (concept.description !== undefined && !isNonEmptyString(concept.description)) {
          errors.push(`${at}: description must be non-empty when present`);
        }
      });
      concepts = raw.concepts;
    }
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
    validateItemFeedback(item.feedback, `${at}.feedback`, errors);
    if (item.concepts !== undefined) {
      if (!Array.isArray(item.concepts) || item.concepts.length === 0
          || !item.concepts.every((conceptId) => CONCEPT_ID.test(conceptId))
          || new Set(item.concepts).size !== item.concepts.length) {
        errors.push(`${at}: concepts must be unique lowercase identifiers when present`);
      } else {
        item.concepts.forEach((conceptId) => {
          if (!conceptIds.has(conceptId)) errors.push(`${at}: unknown concept "${conceptId}"`);
        });
      }
    }
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
    // multi_select (spec §5.5, §4.3): a fixed 2..5 choice set (row-mappable
    // to a card, per §5.3's "≤5 options"), graded exact-set (grading.mjs) —
    // `answers` (plural) is the ANSWER KEY, distinct from single-answer types'
    // `answer`, because more than one choice can be correct at once.
    if (item.type === 'multi_select') {
      if (!Array.isArray(item.choices) || item.choices.length < 2 || item.choices.length > 5) {
        errors.push(`${at}: choices must have between 2 and 5 entries`);
      } else {
        if (!item.choices.every(isNonEmptyString)) errors.push(`${at}: choices must be non-empty strings`);
        if (new Set(item.choices).size !== item.choices.length) errors.push(`${at}: choices must be unique`);
        if (!Array.isArray(item.answers) || item.answers.length === 0) {
          errors.push(`${at}: answers must be a non-empty array`);
        } else {
          if (!item.answers.every(isNonEmptyString)) errors.push(`${at}: answers must be non-empty strings`);
          if (new Set(item.answers).size !== item.answers.length) errors.push(`${at}: answers must be distinct`);
          else if (!item.answers.every((a) => item.choices.includes(a))) errors.push(`${at}: answers must be a subset of choices`);
        }
      }
      if (item.maxSelect !== undefined && (!Number.isInteger(item.maxSelect) || item.maxSelect < 1)) {
        errors.push(`${at}: maxSelect must be an integer >= 1`);
      }
    }
    if (item.type === 'region_click') {
      if (!isNonEmptyString(item.asset)) errors.push(`${at}: asset is required`);
      if (!isNonEmptyString(item.answer)) errors.push(`${at}: answer is required`);
    }
    if (item.type === 'asset_choice') {
      if (item.promptImage !== undefined && !isImageSpec(item.promptImage)) {
        errors.push(`${at}: promptImage must be a mapping of non-empty strings`);
      }
      if (!Array.isArray(item.choices) || item.choices.length < 2) {
        errors.push(`${at}: choices must have >= 2 entries`);
      } else {
        const values = item.choices.map((c) => c?.value);
        if (values.some((v) => !isNonEmptyString(v))) errors.push(`${at}: every choice needs a value`);
        if (new Set(values).size !== values.length) errors.push(`${at}: choice values must be unique`);
        item.choices.forEach((c, ci) => {
          const hasLabel = isNonEmptyString(c?.label);
          const hasImage = c?.image !== undefined && isImageSpec(c.image);
          if (!hasLabel && !hasImage) errors.push(`${at}.choices[${ci}]: needs a label or an image`);
          if (c?.label !== undefined && !hasLabel) errors.push(`${at}.choices[${ci}]: label must be a non-empty string`);
          if (c?.image !== undefined && !hasImage) errors.push(`${at}.choices[${ci}]: image must be a mapping of non-empty strings`);
        });
        if (!isNonEmptyString(item.answer)) errors.push(`${at}: answer is required`);
        else if (!values.includes(item.answer)) errors.push(`${at}: answer must appear in choice values`);
      }
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, bank: { id: raw.id, title: raw.title, audience, topics, subject, concepts, items: raw.items, unit, readalong } };
}

function validateItemFeedback(raw, path, errors) {
  if (raw === undefined || raw === null) return;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${path}: must be a mapping`);
    return;
  }
  const allowed = new Set(['explanation', 'correct', 'incorrect']);
  const unknown = Object.keys(raw).filter((field) => !allowed.has(field));
  if (unknown.length) errors.push(`${path}: unknown fields ${unknown.join(', ')}`);
  for (const field of allowed) {
    if (raw[field] !== undefined && (!isNonEmptyString(raw[field]) || raw[field].length > 1000)) {
      errors.push(`${path}.${field}: must be 1..1000 characters when present`);
    }
  }
  if (!['explanation', 'correct', 'incorrect'].some((field) => raw[field] !== undefined)) {
    errors.push(`${path}: must contain at least one feedback message`);
  }
}

/**
 * Cheap summary for LISTING/shelving a bank — its header fields + item count,
 * WITHOUT the per-item validation loop above (the expensive part: thousands of
 * question checks across every bank, ~5s that blocks the event loop). Listing
 * doesn't render items, so it doesn't need them validated; full validation
 * happens only when a bank is actually opened (validateQuestionBank, via
 * getBank). Returns null for a bank missing the essentials that even a tile
 * needs (id/title, a non-empty items array, a legible audience).
 *
 * @param {*} raw - parsed bank YAML
 * @returns {{id, title, audience, topics, subject, itemCount, unit}|null}
 */
export function summarizeQuestionBank(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.title)) return null;
  if (!Array.isArray(raw.items) || raw.items.length === 0) return null;
  const audience = raw.audience === undefined || raw.audience === null ? 'assigned' : raw.audience;
  if (!AUDIENCES.has(audience)) return null;
  const topics = Array.isArray(raw.topics) && raw.topics.every((t) => typeof t === 'string') ? raw.topics : [];
  return {
    id: raw.id,
    title: raw.title,
    audience,
    topics,
    subject: isNonEmptyString(raw.subject) ? raw.subject : null,
    itemCount: raw.items.length,
    unit: isNonEmptyString(raw.unit) ? raw.unit : undefined,
  };
}
