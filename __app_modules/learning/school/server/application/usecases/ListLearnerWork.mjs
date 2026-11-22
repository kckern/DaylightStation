import { ValidationError } from '#domains/core/errors/index.mjs';
import {
  booksToWork, sessionsToWork, activitiesToWork, cardLadderToWork, inWindow,
} from '../../domain/learnerWork.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOOP_LOGGER = Object.freeze({});
const list = (value) => (Array.isArray(value) ? value : []);
const errorText = (err) => (err instanceof Error ? err.message : String(err));

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
  #logger;

  /**
   * `cardLadderTitleFor(packageId)` (optional, sync or async) names a card
   * ladder package for a person; the store only knows package slugs, and the
   * human title lives in the package lexicon (`program.title`). Without it the
   * card falls back to the slug.
   */
  constructor({
    learners, bookLog = null, bookRepository = null, coverUrlFor = null, sessions = null,
    curriculum = null, printedActivities = null, cardLadder = null, cardLadderTitleFor = null,
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
    this.#logger = logger ?? NOOP_LOGGER;
  }

  async execute({ from, to } = {}) {
    if (typeof from !== 'string' || !DAY.test(from)) throw new ValidationError('from must be YYYY-MM-DD');
    if (typeof to !== 'string' || !DAY.test(to)) throw new ValidationError('to must be YYYY-MM-DD');
    const started = Date.now();
    const roster = list(await this.#learners()).filter((l) => l && typeof l.id === 'string' && l.id);
    // One title lookup per package for the whole call, however many learners
    // study it.
    const titleFor = this.#memoizedTitleFor();
    const perLearner = await Promise.all(roster.map((learner) => this.#workFor(learner, from, to, titleFor)));
    const items = perLearner.flat();
    this.#logger.info?.('school.learner-work.listed', {
      from, to, learners: roster.length, items: items.length, ms: Date.now() - started,
    });
    return { items };
  }

  #memoizedTitleFor() {
    const titleFor = this.#cardLadderTitleFor;
    if (!titleFor) return null;
    const seen = new Map();
    return (packageId) => {
      if (!seen.has(packageId)) seen.set(packageId, Promise.resolve().then(() => titleFor(packageId)));
      return seen.get(packageId);
    };
  }

  async #workFor({ id: learnerId, name }, from, to, titleFor) {
    const ctx = { learnerId, learnerName: name ?? null, from, to };
    const sources = [
      ['books', this.#bookLog && (() => this.#books(ctx))],
      ['sessions', this.#sessions && (() => this.#courseSessions(ctx))],
      ['activities', this.#printedActivities && (() => this.#activities(ctx))],
      ['cardLadder', this.#cardLadder && (() => this.#ladder(ctx, titleFor))],
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
}

export default ListLearnerWork;
