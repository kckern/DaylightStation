// Optional "learn" note any game content item may carry: a short passage shown
// after the answer, e.g. the verse a clue was drawn from.
//   learn: { text, ref?, translation?, note? }

const OPTIONAL_FIELDS = ['ref', 'translation', 'note'];

export function validateLearn(learn, path) {
  if (learn == null) return [];
  if (typeof learn !== 'object' || Array.isArray(learn)) return [`${path}.learn must be an object`];
  const errors = [];
  if (typeof learn.text !== 'string' || !learn.text) errors.push(`${path}.learn.text is required`);
  for (const field of OPTIONAL_FIELDS) {
    if (learn[field] != null && typeof learn[field] !== 'string') errors.push(`${path}.learn.${field} must be a string`);
  }
  return errors;
}

export function normalizeLearn(learn) {
  if (learn == null || typeof learn !== 'object') return null;
  const out = { text: learn.text };
  for (const field of OPTIONAL_FIELDS) if (typeof learn[field] === 'string' && learn[field]) out[field] = learn[field];
  return out;
}
