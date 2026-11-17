/**
 * Make a model's gratitude subject match the household list: sentence case,
 * no framing phrase, no wrapping quotes, no trailing punctuation. Casing is
 * decided here so it never depends on the model. Only the first letter is
 * changed; the rest stays as the model returned it, so names keep their
 * capitals. Phrases are never rebuilt here: keeping the activity ("Eating
 * cookies", not "Cookies") is the prompt's job.
 */
const FRAME = /^(?:i(?:'|’)?m|i am|we(?:'|’)?re|we are)\s+(?:(?:so|really|very)\s+)?(?:grateful|thankful)\s+(?:for|that)\s+/i;
const QUOTES = /^["'“”‘’]+|["'“”‘’]+$/gu;
const TRAILING = /[.!?,;:]+$/u;
const MAX = 160;

export function normalizeGratitudeSubject(raw) {
  if (typeof raw !== 'string') return null;
  let subject = raw.trim().replace(QUOTES, '').trim();
  subject = subject.replace(FRAME, '').trim();
  subject = subject.replace(TRAILING, '').trim();
  if (!subject) return null;
  const chars = Array.from(subject);
  const first = chars.findIndex(c => /\p{L}/u.test(c));
  if (first >= 0) chars[first] = chars[first].toLocaleUpperCase('en-US');
  subject = chars.join('');
  return subject.length > MAX ? null : subject;
}
