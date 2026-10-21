/**
 * Class board → home notes. A weekly class's board posts (the teacher's dated
 * "what we did / homework" posts) and a class calendar become dated teacher
 * notes: last class's homework and the read-ahead for the next class. The
 * notes ride the agenda's "Notes for you" window (their day and the next).
 *
 * Everything about a particular board lives in its config (`school.class-board/v1`):
 * where the posts come from and their field paths (`source`), the patterns
 * that read a post (`parse`), and the note wording (`notes.templates`). This
 * module only applies them.
 */

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Rich-text post HTML → plain lines (paragraphs and list items become lines). */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m)
    .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** `a.b.0.c` → value; a missing step is undefined. */
export function pick(value, dotted) {
  if (!dotted) return undefined;
  return String(dotted).split('.').reduce((at, key) => (at == null ? undefined : at[key]), value);
}

const REQUIRED_PATTERNS = ['classDate', 'homeworkStart', 'sectionEnd', 'lesson'];

/** Compile a config's `parse` block once; a missing or invalid pattern is an error. */
export function compileParse(parse = {}) {
  for (const key of REQUIRED_PATTERNS) if (typeof parse[key] !== 'string') throw new Error(`class-board config: parse.${key} is required`);
  const rx = (key, flags = '') => (parse[key] ? new RegExp(parse[key], flags) : null);
  return { classDate: rx('classDate'), homeworkStart: rx('homeworkStart'), sectionEnd: rx('sectionEnd'), extraLines: rx('extraLines'), noHomework: rx('noHomework'), lesson: rx('lesson', 'g') };
}

/** The class date a title names (pattern groups: year, month, day) → `YYYY-MM-DD`, else null. */
export function classDateOf(title, rules) {
  const m = rules.classDate.exec(String(title ?? ''));
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/**
 * The homework section as the teacher wrote it: the text after the
 * `homeworkStart` line's marker, the lines under it until `sectionEnd`, and any
 * later `extraLines` line. `''` when it matches `noHomework`; null when the
 * post has no homework section.
 */
export function homeworkOf(text, rules) {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((line) => rules.homeworkStart.test(line));
  if (start < 0) return null;
  const parts = [lines[start].replace(rules.homeworkStart, '')];
  for (const line of lines.slice(start + 1)) {
    if (rules.sectionEnd.test(line)) break;
    parts.push(line);
  }
  const extras = rules.extraLines ? lines.slice(start + 1).filter((line) => rules.extraLines.test(line) && !parts.includes(line)) : [];
  const homework = [...parts, ...extras].map((p) => p.replace(/^\*+\s*/, '')).filter(Boolean).join(' / ');
  return rules.noHomework?.test(homework) ? '' : homework;
}

/** Lesson numbers a post says were taught (the `lesson` pattern's first group). */
export function lessonsOf(text, rules) {
  return [...new Set([...String(text ?? '').matchAll(rules.lesson)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/** One post (source shape, read through `fields`) → the archived record. */
export function postRecord(post, { fields, rules }) {
  const text = htmlToText(pick(post, fields.html));
  const seconds = pick(post, fields.updatedSeconds);
  const title = pick(post, fields.title) ?? '';
  return {
    postId: String(pick(post, fields.id)),
    title,
    classDate: classDateOf(title, rules),
    pinned: pick(post, fields.pinned) === true,
    updatedAt: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null,
    homework: homeworkOf(text, rules),
    lessons: lessonsOf(text, rules),
    attachments: (pick(post, fields.attachments) ?? []).map((f) => ({ name: pick(f, fields.attachmentName), url: pick(f, fields.attachmentUrl) })),
    text,
  };
}

/** `{name}` placeholders filled from `values`; a template is config, never code. */
export function fill(template, values) {
  if (typeof template !== 'string') throw new Error('class-board config: a notes template is missing');
  return template.replace(/\{(\w+)\}/g, (_m, key) => String(values[key] ?? ''));
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const isoDow = (day) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** `day` at `hh:mm` local wall time in `timeZone`, as an ISO instant with its offset. */
export function localInstant(day, hhmm, timeZone) {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(guess).find((p) => p.type === 'timeZoneName').value;
  const offset = name === 'GMT' ? '+00:00' : name.replace('GMT', '');
  return `${day}T${hhmm}:00${offset}`;
}

/**
 * The read-ahead line for the class on `upcoming`. Prep is the calendar's
 * lesson, but never more than one lesson past the furthest lesson the posts
 * say was taught, so a slow week does not race ahead.
 */
export function prepLine(calendar, templates, upcoming, taughtMax) {
  const when = fill(templates.when, { date: md(upcoming.date) });
  if (upcoming.noClass) return fill(templates.noClass, { when, noClass: upcoming.noClass });
  if (upcoming.exam) return fill(templates.exam, { when, exam: upcoming.exam, review: upcoming.review ?? '' });
  if (!upcoming.lesson) return null;
  const lesson = taughtMax ? Math.min(upcoming.lesson, taughtMax + 1) : upcoming.lesson;
  return fill(templates.prep, { when, lesson, pages: calendar.lessons?.[lesson] ?? '' });
}

/** The homework line for the class before a note day, from its post (or the missing-post line). */
export function homeworkLine(templates, lastClass, records) {
  if (!lastClass || lastClass.noClass) return null;
  // A class day can also carry a notice (an event post); the one with a homework section wins.
  const post = records.filter((r) => r.classDate === lastClass.date)
    .sort((a, b) => Number(b.homework !== null) - Number(a.homework !== null) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  const date = md(lastClass.date);
  if (!post || post.homework === null) return fill(templates.homeworkMissing, { date });
  if (post.homework === '') return null;
  return fill(templates.homework, { date, homework: post.homework });
}

/**
 * Dated notes for the configured learner on each note day in [from, to]:
 * the read-ahead for the next class, then homework from the last class (a
 * minute later, so it lists first). Ids are deterministic
 * (`<idPrefix>-<day>-prep|hw`), so a re-run can skip what exists.
 */
export function classNotes({ notes, calendar, records, learnerId, from, to, timeZone, by = null }) {
  const classes = [...(calendar.classes ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const { templates, days = [1, 3, 5], idPrefix = `class-${learnerId}`, maxChars = 110, times = {} } = notes;
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (!days.includes(isoDow(day))) continue;
    const lastClass = classes.filter((c) => c.date < day).at(-1);
    const upcoming = classes.find((c) => c.date >= day);
    const taughtMax = Math.max(0, ...records.filter((r) => r.classDate && r.classDate < day).flatMap((r) => r.lessons));
    const lines = [
      ['prep', upcoming ? prepLine(calendar, templates, upcoming, taughtMax) : null, times.prep ?? '07:00'],
      ['hw', homeworkLine(templates, lastClass, records), times.homework ?? '07:01'],
    ];
    for (const [kind, note, hhmm] of lines) {
      if (note) out.push({ id: `${idPrefix}-${day}-${kind}`, at: localInstant(day, hhmm, timeZone), from: by, learnerId, note: clip(note, maxChars) });
    }
  }
  return out;
}

/**
 * When each lesson's cards open: `leadDays` before the first class that
 * teaches it (calendar classes, then `projectedLessons: {n: firstClassDate}`
 * for lessons the calendar does not reach yet). Sorted by lesson.
 */
export function lessonOpenings(calendar, leadDays = 6) {
  const first = new Map();
  for (const c of [...(calendar.classes ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (c.lesson && !first.has(Number(c.lesson))) first.set(Number(c.lesson), c.date);
  }
  for (const [lesson, date] of Object.entries(calendar.projectedLessons ?? {})) if (!first.has(Number(lesson))) first.set(Number(lesson), date);
  return [...first].sort((a, b) => a[0] - b[0]).map(([lesson, date]) => ({ lesson, opensOn: addDays(date, -leadDays) }));
}

/**
 * The class deck as of `day`: every opened lesson's words in lesson order
 * (first lesson to name a word keeps it) with a release per lesson. Lessons
 * not yet open are left out of `words` entirely, so the deck paces itself
 * even where the card ladder predates `releases`.
 */
export function classDeck({ deck, calendar, lessonWords, day }) {
  const words = [];
  const releases = [];
  const seen = new Set();
  for (const { lesson, opensOn } of lessonOpenings(calendar, deck.leadDays)) {
    if (opensOn > day) continue;
    const fresh = (lessonWords(lesson) ?? []).filter((id) => !seen.has(id));
    fresh.forEach((id) => seen.add(id));
    words.push(...fresh);
    if (fresh.length) releases.push({ opensOn, words: fresh });
  }
  return { schema: 'school.flashcard-deck/v1', id: deck.id, title: deck.title, revision: releases.length, lexicon: deck.lexicon, words, releases };
}
