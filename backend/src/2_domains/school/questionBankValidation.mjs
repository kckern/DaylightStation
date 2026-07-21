/**
 * Pure validation + normalisation of a question bank (spec §4). No I/O.
 * Fail-closed: audience defaults to 'assigned' so an omission never exposes a
 * bank to guests.
 */
const ITEM_TYPES = new Set(['multiple_choice', 'short_answer', 'cloze', 'matching']);
const AUDIENCES = new Set(['generic', 'assigned']);

export function validateQuestionBank(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['bank must be a mapping'] };
  }
  if (!raw.id || typeof raw.id !== 'string') errors.push('id is required');
  if (!raw.title || typeof raw.title !== 'string') errors.push('title is required');
  const audience = raw.audience === undefined ? 'assigned' : raw.audience;
  if (!AUDIENCES.has(audience)) errors.push(`audience must be generic|assigned, got: ${raw.audience}`);
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
    if (!item.prompt || typeof item.prompt !== 'string') errors.push(`${at}: prompt is required`);
    if (item.type === 'multiple_choice') {
      if (!Array.isArray(item.choices) || item.choices.length < 2) errors.push(`${at}: choices must have >= 2 entries`);
      else {
        if (new Set(item.choices).size !== item.choices.length) errors.push(`${at}: choices must be unique`);
        if (!item.choices.includes(item.answer)) errors.push(`${at}: answer must appear in choices`);
      }
    }
    if (item.type === 'short_answer' || item.type === 'cloze') {
      if (!item.answer || typeof item.answer !== 'string') errors.push(`${at}: answer is required`);
      if (item.accept !== undefined && !Array.isArray(item.accept)) errors.push(`${at}: accept must be an array`);
    }
    if (item.type === 'cloze') {
      const blanks = (String(item.prompt).match(/___/g) || []).length;
      if (blanks !== 1) errors.push(`${at}: cloze prompt must contain the blank marker ___ exactly once (found ${blanks})`);
    }
    if (item.type === 'matching') {
      if (!Array.isArray(item.pairs) || item.pairs.length < 2) errors.push(`${at}: pairs must have >= 2 entries`);
      else {
        const lefts = item.pairs.map((p) => p?.left); const rights = item.pairs.map((p) => p?.right);
        if (lefts.some((v) => !v) || rights.some((v) => !v)) errors.push(`${at}: every pair needs left and right`);
        if (new Set(lefts).size !== lefts.length) errors.push(`${at}: left values must be unique`);
        if (new Set(rights).size !== rights.length) errors.push(`${at}: right values must be unique`);
      }
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, bank: { id: raw.id, title: raw.title, audience, topics: Array.isArray(raw.topics) ? raw.topics : [], items: raw.items } };
}
