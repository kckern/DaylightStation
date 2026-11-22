/**
 * Learner work — a child's school week as plain, celebratory work items:
 * books started and finished, course sessions worked, printed pages done,
 * card-ladder days. Weekly review curates these into TV cards.
 *
 * A work item never carries a score, percent, correctness, answer, coin or
 * streak. Each projection builds its item through `workItem`, which emits
 * exactly WORK_ITEM_KEYS, so a graded field on a store row cannot leak.
 *
 * Pure: no I/O, no clock. The use case reads the stores and resolves async
 * lookups (book metadata, unit summaries) before calling these.
 */

export const WORK_ITEM_KEYS = Object.freeze([
  'learnerId', 'learnerName', 'kind', 'verb', 'title', 'subtitle', 'at', 'studyDay',
  'imageUrl', 'groupKey', 'weight', 'subject',
]);

const SCHOOL_IMAGE_PATH = '/api/v1/weekly-review/school/image?ref=';
const schoolImageUrl = (ref) => SCHOOL_IMAGE_PATH + encodeURIComponent(ref);
const noonUtc = (day) => `${day}T12:00:00Z`;
const list = (value) => (Array.isArray(value) ? value : []);

/** `day` falls in [from, to). YYYY-MM-DD strings compare lexically. */
export function inWindow(day, from, to) {
  return typeof day === 'string' && day >= from && day < to;
}

function workItem({ learnerId, learnerName }, fields) {
  return {
    learnerId: learnerId ?? null,
    learnerName: learnerName ?? null,
    kind: fields.kind ?? null,
    verb: fields.verb ?? null,
    title: fields.title ?? null,
    subtitle: fields.subtitle ?? null,
    at: fields.at ?? null,
    studyDay: fields.studyDay ?? null,
    imageUrl: fields.imageUrl ?? null,
    groupKey: fields.groupKey ?? null,
    weight: Number.isFinite(fields.weight) ? fields.weight : 0,
    subject: fields.subject ?? null,
  };
}

const finishedEntries = (reading) => list(reading?.entries).filter((e) => e?.kind === 'finished');
const latestEntry = (entries) => entries.reduce((best, e) => {
  if (!best) return e;
  const key = (x) => `${x.on ?? ''}|${x.at ?? ''}`;
  return key(e) > key(best) ? e : best;
}, null);

/** The day a reading was finished inside the window, with its timestamp, or null. */
function finishInWindow(reading, from, to) {
  const finished = finishedEntries(reading);
  if (inWindow(reading.finishedOn, from, to)) {
    const match = latestEntry(finished.filter((e) => e.on === reading.finishedOn));
    return { studyDay: reading.finishedOn, at: match?.at ?? noonUtc(reading.finishedOn) };
  }
  const entry = latestEntry(finished.filter((e) => inWindow(e.on, from, to)));
  return entry ? { studyDay: entry.on, at: entry.at ?? noonUtc(entry.on) } : null;
}

export function booksToWork(readings, { learnerId, learnerName, from, to, bookFor, coverUrlFor }) {
  const who = { learnerId, learnerName };
  const items = [];
  for (const reading of list(readings)) {
    if (!reading || reading.status === 'unread') continue;
    const isbn = reading.book?.isbn ?? null;
    const key = reading.id ?? isbn;
    if (!key) continue;
    const book = isbn && bookFor ? bookFor(isbn) : null;
    const base = {
      kind: 'book',
      title: book?.title || 'A book',
      subtitle: list(book?.authors)[0] || null,
      imageUrl: isbn && coverUrlFor ? coverUrlFor(isbn) ?? null : null,
      weight: 1,
      subject: 'reading',
    };
    if (inWindow(reading.openedOn, from, to)) {
      items.push(workItem(who, {
        ...base,
        verb: 'started',
        at: reading.openedRecordedAt ?? noonUtc(reading.openedOn),
        studyDay: reading.openedOn,
        groupKey: `book:${key}:started`,
      }));
    }
    const finish = finishInWindow(reading, from, to);
    if (finish) {
      items.push(workItem(who, {
        ...base,
        verb: 'finished',
        at: finish.at,
        studyDay: finish.studyDay,
        groupKey: `book:${key}:finished`,
      }));
    }
  }
  return items;
}

export function sessionsToWork(sessions, { learnerId, learnerName, from, to, unitSummary }) {
  const who = { learnerId, learnerName };
  const items = [];
  for (const session of list(sessions)) {
    if (session?.terminal !== true || !inWindow(session.studyDay, from, to)) continue;
    const summary = unitSummary ? unitSummary(session.unitId) : null;
    const courseId = summary?.courseId ?? null;
    items.push(workItem(who, {
      kind: 'course',
      verb: session.outcome?.result === 'passed' ? 'completed' : 'worked',
      title: summary?.courseTitle ?? summary?.title ?? 'Schoolwork',
      subtitle: summary?.courseTitle ? summary.title ?? null : null,
      at: session.outcome?.at ?? session.updatedAt,
      studyDay: session.studyDay,
      imageUrl: courseId ? schoolImageUrl(`course:${courseId}`) : null,
      groupKey: `course:${courseId ?? session.unitId}`,
      weight: 1,
      subject: summary?.subject ?? null,
    }));
  }
  return items;
}

/** Worksheet platform kinds as a person reads them ("Color by number", not "Colorbynumber"). */
const ACTIVITY_KIND_LABELS = Object.freeze({
  maze: 'Maze', sudoku: 'Sudoku', coloring: 'Coloring', colorbynumber: 'Color by number',
  tracing: 'Tracing', wordsearch: 'Word search', dottodot: 'Dot to dot', crossword: 'Crossword',
});

/**
 * A kind's label: the known ones from the table; anything else split on
 * camelCase, underscores and hyphens into words, in sentence case.
 */
export function activityKindLabel(kind) {
  if (typeof kind !== 'string' || !kind.trim()) return null;
  const known = ACTIVITY_KIND_LABELS[kind.trim().toLowerCase()];
  if (known) return known;
  const words = kind.trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (!words.length) return null;
  const text = words.join(' ');
  return text[0].toUpperCase() + text.slice(1);
}

function activitySubtitle({ kind, level }) {
  const label = activityKindLabel(kind);
  const levelPart = typeof level === 'number' && Number.isFinite(level) ? `level ${level}` : null;
  return [label, levelPart].filter(Boolean).join(' · ') || null;
}

export function activitiesToWork(issuances, { learnerId, learnerName, from, to }) {
  const who = { learnerId, learnerName };
  return list(issuances)
    .filter((i) => i && !i.voidedAt && inWindow(i.completedStudyDay, from, to))
    .map((i) => workItem(who, {
      kind: 'activity',
      verb: 'completed',
      title: i.title || activitySubtitle(i) || 'A printed page',
      subtitle: activitySubtitle(i),
      at: i.completedAt,
      studyDay: i.completedStudyDay,
      imageUrl: schoolImageUrl(`activity:${i.issuanceId}`),
      groupKey: `activity:${i.issuanceId}`,
      weight: 1,
      subject: 'activity',
    }));
}

export function cardLadderToWork(days, { learnerId, learnerName, from, to, packageId, packageTitle }) {
  const who = { learnerId, learnerName };
  const items = [];
  for (const file of list(days)) {
    if (!file || !inWindow(file.day, from, to)) continue;
    const n = file.items && typeof file.items === 'object' ? Object.keys(file.items).length : 0;
    if (n < 1) continue;
    items.push(workItem(who, {
      kind: 'program',
      verb: 'worked',
      title: packageTitle ?? packageId ?? 'Language practice',
      subtitle: n === 1 ? '1 word' : `${n} words`,
      at: file.doneAt ?? noonUtc(file.day),
      studyDay: file.day,
      imageUrl: null,
      groupKey: `program:card-ladder:${packageId}`,
      weight: n,
      subject: 'language',
    }));
  }
  return items;
}
