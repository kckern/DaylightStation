/**
 * Make a model's gratitude subject match the household list: sentence case,
 * no framing phrase, no wrapping quotes, no trailing punctuation. Casing is
 * decided here so it never depends on the model. Only the first letter is
 * changed; the rest stays as the model returned it, so names keep their
 * capitals. Phrases are never rebuilt here: keeping the activity ("Eating
 * cookies", not "Cookies") is the prompt's job.
 */
const FRAME = /^(?:i(?:'|’)?m|i am|we(?:'|’)?re|we are)\s+(?:(?:so|really|very)\s+)?(?:grateful|thankful)(?:\s+(?:for|that))?(?:\s+|$)/i;
const QUOTES = /^["'“”‘’]+|["'“”‘’]+$/gu;
const TRAILING = /[.!?,;:]+$/u;
const MAX = 160;

// One cleaning pass: trailing punctuation, wrapping quotes, the framing
// phrase. Repeated until nothing changes, so quotes inside a frame
// (`I am grateful for "cookies".`) and a frame with nothing after it both go.
function clean(text) {
  let previous;
  let subject = text.trim();
  do {
    previous = subject;
    subject = subject.replace(TRAILING, '').trim();
    subject = subject.replace(QUOTES, '').trim();
    subject = subject.replace(FRAME, '').trim();
  } while (subject !== previous);
  return subject;
}

const isUpper = c => c !== c.toLocaleLowerCase('en-US') && c === c.toLocaleUpperCase('en-US');

export function normalizeGratitudeSubject(raw) {
  if (typeof raw !== 'string') return null;
  const subject = clean(raw);
  if (!subject) return null;
  const chars = Array.from(subject);
  // The first letter or digit decides: a digit ("3 new friends") is left
  // alone, and so is a word already mixed-case ("iPad time"). Scripts without
  // letter case (Korean) are unchanged by toLocaleUpperCase.
  const first = chars.findIndex(c => /[\p{L}\p{N}]/u.test(c));
  if (first >= 0 && /\p{L}/u.test(chars[first]) && !isUpper(chars[first + 1] ?? '')) {
    chars[first] = chars[first].toLocaleUpperCase('en-US');
  }
  const result = chars.join('');
  // The limit applies to the cleaned subject.
  return result.length > MAX ? null : result;
}
