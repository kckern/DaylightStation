// scoreLabel.js — what a child reads where a score names its work. Courses and
// units have no authored display titles here, so the name comes from the slug;
// a printed worksheet's session id (`ws-ses-…@hash`) is never shown at all.

const CODE = /^[wdp]\d{1,4}$/i; // week, day and page codes: cfm-w47-d3-…, atlas-us-p038-…
const COURSE_CODE = /^[a-z]{2,4}\d{1,3}$/i; // a leading course code and its numbers: em23-03-04-…
const MEDIA_ID = /^[a-z]+:\d+$/i; // plex:675964 names a video, not a lesson anyone would recognise
const ACRONYMS = new Map([['us', 'US'], ['ot', 'OT'], ['nt', 'NT']]);
const isNumber = (word) => /^\d+$/.test(word);
const isWorksheetSession = (segment) => /^ws-/i.test(segment);

// Only an ascending pair is a range: chapters 10 to 11, not `korean-3-2` or `1-000`.
const isRange = (a, b) => isNumber(a) && isNumber(b) && !b.startsWith('0') && Number(b) > Number(a);

function withoutCodes(words) {
  const firstName = words.findIndex((w, i) => i > 0 && !isNumber(w));
  const courseCoded = COURSE_CODE.test(words[0] ?? '') && firstName > 1;
  const named = courseCoded ? words.slice(firstName) : words;
  const lastCode = named.findLastIndex((w) => CODE.test(w));
  return lastCode >= 0 && lastCode < named.length - 1 ? named.slice(lastCode + 1) : named;
}

const word = (w) => ACRONYMS.get(w.toLowerCase()) ?? w[0].toUpperCase() + w.slice(1);

/** `cfm-w47-d3-hosea-10-11` → `Hosea 10–11`; `come-follow-me-ot-2026` → `Come Follow Me OT 2026`. */
export function learningSlugLabel(slug) {
  const id = String(slug ?? '').replace(/@.*$/, '');
  if (MEDIA_ID.test(id)) return 'Video lesson';
  const words = id.replace(/^[a-z]+:/i, '').split(/[-_.]+/).filter(Boolean);
  const labels = withoutCodes(words).map(word);
  const n = labels.length;
  if (n >= 3 && isRange(labels[n - 2], labels[n - 1]) && !isNumber(labels[n - 3])) {
    return [...labels.slice(0, n - 2), `${labels[n - 2]}–${labels[n - 1]}`].join(' ');
  }
  return labels.join(' ');
}

function pathLabel(id) {
  const segments = String(id).split('/').filter(Boolean);
  const last = segments.at(-1) ?? '';
  // A worksheet session sits under its course: subject/course/ws-ses-….
  const named = isWorksheetSession(last) ? segments.at(-2) : last;
  return named ? learningSlugLabel(named) : '';
}

/** A results-lane name when the bank has no catalog title. A bare id is left as it is. */
export function bankScoreLabel(bankId) {
  const id = String(bankId ?? '');
  return /[/:]/.test(id) ? pathLabel(id) || id : id;
}

/** A recent score's title: its lesson, else its unit, else what the activity id still says. */
export function recentScoreTitle(score) {
  const raw = score?.learning?.lessonId ?? score?.learning?.unitId ?? score?.activityId ?? '';
  return pathLabel(raw) || String(raw);
}
