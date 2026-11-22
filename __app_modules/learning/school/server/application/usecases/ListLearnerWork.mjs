import { ValidationError } from '#domains/core/errors/index.mjs';
import {
  booksToWork, sessionsToWork, activitiesToWork, cardLadderToWork, pianoLessonsToWork, sentenceLadderToWork, inWindow,
} from '../../domain/learnerWork.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOOP_LOGGER = Object.freeze({});
const list = (value) => (Array.isArray(value) ? value : []);
const errorText = (err) => (err instanceof Error ? err.message : String(err));
const DAY_MS = 86_400_000;
const dayMs = (day) => Date.parse(`${day}T00:00:00Z`);
const isoDayStart = (day, offsetDays = 0) => new Date(dayMs(day) + offsetDays * DAY_MS).toISOString();
/** Every YYYY-MM-DD from `first` through `last`, inclusive. */
function datesThrough(first, last) {
  const out = [];
  for (let ms = dayMs(first); ms <= dayMs(last); ms += DAY_MS) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}
/** Per-call memo of an optional, possibly async lookup; null when absent. */
function memoize(fn) {
  if (typeof fn !== 'function') return null;
  const seen = new Map();
  return (key) => {
    if (!seen.has(key)) seen.set(key, Promise.resolve().then(() => fn(key)));
    return seen.get(key);
  };
}

/** Resolve `fn(key)` for each distinct key; a throw or rejection becomes null (and a warn). */
async function lookupAll(keys, fn, { source, logger }) {
  const distinct = [...new Set(keys.filter((k) => k != null && k !== ''))];
  const entries = await Promise.all(distinct.map(async (key) => {
    try {
      return [key, (await fn(key)) ?? null];
    } catch (err) {
      logger.warn?.('school.learner-work.lookup-failed', { source, key, error: errorText(err) });
      return [key, null];
    }
  }));
  return new Map(entries);
}

/**
 * ListLearnerWork — every learner's school work inside [from, to), as plain
 * work items (see domain/learnerWork.mjs). Weekly review curates them into TV
 * cards, so nothing here carries a score.
 *
 * Each store is optional: an absent one is skipped. Learners and their
 * sources are read in parallel, and a source that throws for one learner
 * counts as no work for that source only (logged as
 * `school.learner-work.source-failed`); the rest of the week still shows.
 *
 * Book metadata and unit summaries can be async, so they are resolved here
 * up front and handed to the pure projections as sync lookups.
 */
export class ListLearnerWork {
  #learners;
  #bookLog;
  #bookRepository;
  #coverUrlFor;
  #sessions;
  #curriculum;
  #printedActivities;
  #cardLadder;
  #cardLadderTitleFor;
  #learningEvidence;
  #lessonSittingLog;
  #pianoCourseTitleFor;
  #languageStudy;
  #sentenceLadderTitleFor;
  #dayOf;
  #logger;

  /**
   * `cardLadderTitleFor(packageId)` (optional, sync or async) names a card
   * ladder package for a person; the store only knows package slugs, and the
   * human title lives in the package lexicon (`program.title`). Without it the
   * card falls back to the slug.
   *
   * Piano lessons come from School's learning evidence (`learningEvidence`,
   * rows with `activity.kind: piano_lesson`), named by the piano sitting log
   * (`lessonSittingLog.list`, titles only) and `pianoCourseTitleFor(courseId)`
   * (optional, sync or async). The sentence ladder reads
   * `languageStudy` (`listCorpusIds`, `readEventDay`) and names a corpus with
   * `sentenceLadderTitleFor(corpusId)` (optional, sync or async), else the
   * corpus file's `label` via `languageStudy.readCorpus`. `dayOf`
   * maps an ISO instant to the household study day; without it both sources
   * fall back to the UTC date.
   */
  constructor({
    learners, bookLog = null, bookRepository = null, coverUrlFor = null, sessions = null,
    curriculum = null, printedActivities = null, cardLadder = null, cardLadderTitleFor = null,
    learningEvidence = null, lessonSittingLog = null, pianoCourseTitleFor = null,
    languageStudy = null, sentenceLadderTitleFor = null, dayOf = null,
    logger = NOOP_LOGGER,
  } = {}) {
    if (typeof learners !== 'function') throw new Error('ListLearnerWork requires learners');
    this.#learners = learners;
    this.#bookLog = bookLog;
    this.#bookRepository = bookRepository;
    this.#coverUrlFor = typeof coverUrlFor === 'function' ? coverUrlFor : null;
    this.#sessions = sessions;
    this.#curriculum = curriculum;
    this.#printedActivities = printedActivities;
    this.#cardLadder = cardLadder;
    this.#cardLadderTitleFor = typeof cardLadderTitleFor === 'function' ? cardLadderTitleFor : null;
    this.#learningEvidence = typeof learningEvidence?.listEvidence === 'function' ? learningEvidence : null;
    this.#lessonSittingLog = typeof lessonSittingLog?.list === 'function' ? lessonSittingLog : null;
    this.#pianoCourseTitleFor = typeof pianoCourseTitleFor === 'function' ? pianoCourseTitleFor : null;
    this.#languageStudy = typeof languageStudy?.readEventDay === 'function' ? languageStudy : null;
    this.#sentenceLadderTitleFor = typeof sentenceLadderTitleFor === 'function' ? sentenceLadderTitleFor : null;
    this.#dayOf = typeof dayOf === 'function' ? dayOf : null;
    this.#logger = logger ?? NOOP_LOGGER;
  }

  async execute({ from, to } = {}) {
    if (typeof from !== 'string' || !DAY.test(from)) throw new ValidationError('from must be YYYY-MM-DD');
    if (typeof to !== 'string' || !DAY.test(to)) throw new ValidationError('to must be YYYY-MM-DD');
    const started = Date.now();
    const roster = list(await this.#learners()).filter((l) => l && typeof l.id === 'string' && l.id);
    // One title lookup per package for the whole call, however many learners
    // study it.
    const memo = {
      cardLadderTitle: memoize(this.#cardLadderTitleFor),
      pianoCourseTitle: memoize(this.#pianoCourseTitleFor),
      corpusTitle: memoize(this.#sentenceLadderTitleFor
        ?? ((corpusId) => this.#languageStudy?.readCorpus?.(corpusId)?.label ?? null)),
      corpusIds: this.#languageStudy ? memoize(() => this.#languageStudy.listCorpusIds?.() ?? []) : null,
    };
    const perLearner = await Promise.all(roster.map((learner) => this.#workFor(learner, from, to, memo)));
    const items = perLearner.flat();
    this.#logger.info?.('school.learner-work.listed', {
      from, to, learners: roster.length, items: items.length, ms: Date.now() - started,
    });
    return { items };
  }

  async #workFor({ id: learnerId, name }, from, to, memo) {
    const ctx = { learnerId, learnerName: name ?? null, from, to };
    const sources = [
      ['books', this.#bookLog && (() => this.#books(ctx))],
      ['sessions', this.#sessions && (() => this.#courseSessions(ctx))],
      ['activities', this.#printedActivities && (() => this.#activities(ctx))],
      ['cardLadder', this.#cardLadder && (() => this.#ladder(ctx, memo.cardLadderTitle))],
      ['pianoLessons', this.#learningEvidence && (() => this.#pianoLessons(ctx, memo.pianoCourseTitle))],
      ['sentenceLadder', this.#languageStudy && (() => this.#sentenceLadder(ctx, memo))],
    ].filter(([, read]) => read);
    const results = await Promise.all(sources.map(async ([source, read]) => {
      try {
        return await read();
      } catch (err) {
        this.#logger.warn?.('school.learner-work.source-failed', { learnerId, source, error: errorText(err) });
        return [];
      }
    }));
    return results.flat();
  }

  async #books(ctx) {
    const readings = list(await this.#bookLog.listForLearner(ctx.learnerId));
    const repo = this.#bookRepository;
    const books = repo
      ? await lookupAll(readings.map((r) => r?.book?.isbn), (isbn) => repo.findByIsbn(isbn), { source: 'books', logger: this.#logger })
      : new Map();
    return booksToWork(readings, {
      ...ctx,
      bookFor: (isbn) => books.get(isbn) ?? null,
      coverUrlFor: this.#coverUrlFor,
    });
  }

  async #courseSessions(ctx) {
    const rows = list(await this.#sessions.listForLearner(ctx.learnerId));
    const curriculum = this.#curriculum;
    const unitIds = rows
      .filter((s) => s?.terminal === true && inWindow(s.studyDay, ctx.from, ctx.to))
      .map((s) => s.unitId);
    const summaries = curriculum?.getUnitSummary
      ? await lookupAll(unitIds, (unitId) => curriculum.getUnitSummary(unitId), { source: 'sessions', logger: this.#logger })
      : new Map();
    return sessionsToWork(rows, { ...ctx, unitSummary: (unitId) => summaries.get(unitId) ?? null });
  }

  async #activities(ctx) {
    const issuances = list(await this.#printedActivities.listForLearner(ctx.learnerId));
    return activitiesToWork(issuances, ctx);
  }

  async #ladder(ctx, titleFor) {
    const store = this.#cardLadder;
    const packages = list(await store.listPackages(ctx.learnerId));
    const titles = titleFor ? await lookupAll(packages, titleFor, { source: 'cardLadder', logger: this.#logger }) : new Map();
    const perPackage = await Promise.all(packages.map(async (packageId) => {
      const days = list(await store.listDays(ctx.learnerId, packageId)).filter((d) => inWindow(d, ctx.from, ctx.to));
      const files = await Promise.all(days.map(async (day) => {
        const file = await store.readDay(ctx.learnerId, packageId, day);
        return file ? { ...file, day: file.day ?? day } : null;
      }));
      return cardLadderToWork(files, { ...ctx, packageId, packageTitle: titles.get(packageId) ?? undefined });
    }));
    return perPackage.flat();
  }

  async #pianoLessons(ctx, courseTitleFor) {
    // Evidence is filed by UTC instant; a day either side covers any household
    // offset and the 4am boundary, and the projection trims by study day.
    const rows = list(await this.#learningEvidence.listEvidence({
      learnerIds: [ctx.learnerId], from: isoDayStart(ctx.from, -1), to: isoDayStart(ctx.to, 1),
    })).filter((r) => r?.activity?.kind === 'piano_lesson');
    if (!rows.length) return [];
    const lessonTitles = new Map();
    if (this.#lessonSittingLog) {
      // Titles only: a sitting row also carries score, percent and outcome,
      // and none of that may reach the review.
      const sittings = list(await this.#lessonSittingLog.list(ctx.learnerId, { sinceIso: isoDayStart(ctx.from, -2) }));
      for (const s of sittings) {
        if (typeof s?.plexId === 'string' && typeof s.title === 'string' && !lessonTitles.has(s.plexId)) {
          lessonTitles.set(s.plexId, s.title);
        }
      }
    }
    const courseTitles = courseTitleFor
      ? await lookupAll(rows.map((r) => r.learning?.courseId), courseTitleFor, { source: 'piano', logger: this.#logger })
      : new Map();
    return pianoLessonsToWork(rows, {
      ...ctx,
      dayOf: this.#dayOf,
      lessonTitleFor: (id) => lessonTitles.get(id) ?? null,
      courseTitleFor: (id) => courseTitles.get(id) ?? null,
    });
  }

  async #sentenceLadder(ctx, memo) {
    const store = this.#languageStudy;
    const corpusIds = list(await memo.corpusIds());
    // Log shards are named by the UTC date of each event, not the study day.
    const shards = datesThrough(isoDayStart(ctx.from, -1).slice(0, 10), ctx.to);
    const perCorpus = await Promise.all(corpusIds.map(async (corpusId) => {
      const events = (await Promise.all(shards.map(async (day) => list(await store.readEventDay(ctx.learnerId, corpusId, day))))).flat();
      if (!events.length) return [];
      const titles = await lookupAll([corpusId], memo.corpusTitle, { source: 'sentenceLadder', logger: this.#logger });
      return sentenceLadderToWork(events, {
        ...ctx, dayOf: this.#dayOf, corpusId, corpusTitle: titles.get(corpusId) ?? undefined,
      });
    }));
    return perCorpus.flat();
  }
}

export default ListLearnerWork;
