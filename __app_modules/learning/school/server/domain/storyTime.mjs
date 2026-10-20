/**
 * Story time — a daily reading obligation with no course behind it, and the
 * only thing a parent has to decide about it is HOW MANY.
 *
 * The target lives here, on the enrollment, rather than in `school.yml`:
 * different children owe different counts, and the number is a per-learner
 * teaching decision, not a household setting.
 */
import { SUBJECT_IDS } from "./curriculum/unitValidation.mjs";

export const STORY_TIME_PROGRAM_ID = 'story-time';
export const DEFAULT_STORY_TARGET = 2;

/**
 * A ceiling, on purpose. An unmeetable obligation is a config typo (`target:
 * 100` for `10`) that leaves a child permanently red on the board with no
 * error anywhere — refusing it at write time is far cheaper than diagnosing
 * a stuck tile weeks later.
 */
export const MAX_STORY_TARGET = 20;

/**
 * How many study days a finished story keeps its book off the shelf of an
 * ASSIGNED reader. `4` means: a book read on Monday is refused Tuesday through
 * Thursday and allowed again on Friday. `0` switches the rule off.
 */
export const DEFAULT_STORY_NO_REPEAT_DAYS = 4;
export const MAX_STORY_NO_REPEAT_DAYS = 60;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const dayNumber = (day) => (typeof day === 'string' && DAY_RE.test(day) ? Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS) : NaN);

/** The study-day keys `today, today-1, ... today-(n-1)` — the days a read still counts as recent. */
export function noRepeatWindowDays(today, noRepeatDays) {
  const base = dayNumber(today);
  if (!Number.isFinite(base) || !Number.isInteger(noRepeatDays) || noRepeatDays < 1) return [];
  return Array.from({ length: noRepeatDays }, (_, i) => new Date((base - i) * DAY_MS).toISOString().slice(0, 10));
}

/**
 * Was this book finished within the last `noRepeatDays` study days, TODAY
 * INCLUDED? A read `d` days ago is recent when `d <= noRepeatDays - 1`, so a
 * read exactly `noRepeatDays` days ago is allowed again. `reads` are credited
 * (finished) reads only, each `{studyDay|day, contentId}`; the log never holds
 * an abandoned one. Pure: no I/O, no clock.
 *
 * @returns {{recent: boolean, lastReadOn: string|null}} `lastReadOn` is the
 *   most recent in-window read of the book, null when not recent.
 */
export function recentlyRead({ reads, contentId, today, noRepeatDays } = {}) {
  const none = { recent: false, lastReadOn: null };
  if (!contentId || !Array.isArray(reads)) return none;
  const window = new Set(noRepeatWindowDays(today, noRepeatDays));
  if (!window.size) return none;
  let last = null;
  for (const row of reads) {
    const day = row?.studyDay ?? row?.day;
    if (row?.contentId !== contentId || !window.has(day)) continue;
    if (last === null || day > last) last = day;
  }
  return last ? { recent: true, lastReadOn: last } : none;
}

/** How many other books a refusal offers. Three covers fit a TV notice at sofa distance. */
export const STORY_SUGGESTION_LIMIT = 3;

/**
 * WHAT TO READ INSTEAD. A refusal that only says "pick a different book" leaves
 * a four-year-old standing at the shelf with no idea which one; this names the
 * books that WOULD be accepted, so the screen can show their covers.
 *
 * `corpus` is the household's story books, `[{contentId, title}]` (the NFC book
 * tags — the physical books a child can actually grab). When it is not an array
 * (the registry was not wired), the learner's own history stands in for it.
 * `reads` are credited reads `{studyDay|day, contentId, title}`, as far back as
 * the caller looked; a book with no read in them counts as never read.
 *
 * Order: never read first, then least recently read, then title, then id — so
 * the same shelf gives the same three on every refusal. The reading log's title
 * beats the corpus label: the log holds the book's real title, the tag only a
 * hand-typed note. Pure: no I/O, no clock.
 *
 * @returns {Array<{contentId: string, title: string|null, lastReadOn: string|null}>}
 */
export function suggestStories({ corpus, reads, today, noRepeatDays, exclude = null, limit = STORY_SUGGESTION_LIMIT } = {}) {
  const history = Array.isArray(reads) ? reads : [];
  const window = new Set(noRepeatWindowDays(today, noRepeatDays));
  const lastRead = new Map();
  const loggedTitle = new Map();
  for (const r of history) {
    const day = r?.studyDay ?? r?.day;
    const id = r?.contentId;
    if (!id || typeof day !== 'string' || (today && day > today)) continue;
    if (!lastRead.has(id) || day >= lastRead.get(id)) {
      lastRead.set(id, day);
      if (r.title) loggedTitle.set(id, r.title);
    }
  }
  const shelf = Array.isArray(corpus)
    ? corpus
    : [...lastRead.keys()].map((contentId) => ({ contentId, title: null }));
  const seen = new Set();
  const candidates = [];
  for (const b of shelf) {
    const id = b?.contentId;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    if (id === exclude || window.has(lastRead.get(id))) continue;
    candidates.push({ contentId: id, title: loggedTitle.get(id) ?? (b.title || null), lastReadOn: lastRead.get(id) ?? null });
  }
  const text = (s) => (s.title ?? '').toLowerCase();
  candidates.sort((a, b) => {
    if ((a.lastReadOn === null) !== (b.lastReadOn === null)) return a.lastReadOn === null ? -1 : 1;
    if (a.lastReadOn !== b.lastReadOn) return a.lastReadOn < b.lastReadOn ? -1 : 1;
    if (text(a) !== text(b)) return text(a) < text(b) ? -1 : 1;
    return a.contentId < b.contentId ? -1 : (a.contentId > b.contentId ? 1 : 0);
  });
  return candidates.slice(0, Math.max(0, limit));
}

/** Validate a story-time enrollment. Same `{errors, enrollment}` shape every other program validator returns. */
export function validateStoryTimeEnrollment(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['story-time enrollment must be a mapping'] };
  }
  if (raw.programId !== STORY_TIME_PROGRAM_ID) errors.push(`programId must be ${STORY_TIME_PROGRAM_ID}`);

  const target = raw.target ?? DEFAULT_STORY_TARGET;
  if (!Number.isInteger(target) || target < 1 || target > MAX_STORY_TARGET) {
    errors.push(`target must be an integer from 1 to ${MAX_STORY_TARGET}, got: ${raw.target}`);
  }

  // The subject is a shelf on the board, and the nine are fixed — an unknown
  // one would file the tile nowhere rather than under English.
  // Optional. Absent means the default; 0 turns the no-repeat rule off.
  const noRepeatDays = raw.noRepeatDays;
  if (noRepeatDays !== undefined && noRepeatDays !== null
      && (!Number.isInteger(noRepeatDays) || noRepeatDays < 0 || noRepeatDays > MAX_STORY_NO_REPEAT_DAYS)) {
    errors.push(`noRepeatDays must be an integer from 0 to ${MAX_STORY_NO_REPEAT_DAYS}, got: ${raw.noRepeatDays}`);
  }

  const subject = raw.subject ?? 'english';
  if (!SUBJECT_IDS.includes(subject)) {
    errors.push(`subject must be one of ${SUBJECT_IDS.join('|')}, got: ${raw.subject}`);
  }

  const title = raw.title === undefined || raw.title === null ? null : String(raw.title);
  if (errors.length) return { errors };
  // `corpusId: null` is what makes SetAssignments' dedupe key `story-time\0`
  // refuse a second story-time enrollment for the same learner — one daily
  // obligation, not two.
  return { errors: [], enrollment: {
    programId: STORY_TIME_PROGRAM_ID, corpusId: null, target, subject, title,
    ...(Number.isInteger(noRepeatDays) ? { noRepeatDays } : {}),
  } };
}

export default validateStoryTimeEnrollment;
