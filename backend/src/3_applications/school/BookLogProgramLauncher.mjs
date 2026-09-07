/**
 * BookLogProgramLauncher — the `IProgramLauncher` for the reading shelf.
 *
 * ## THE SHELF DOES NOT NEED THIS FILE; THE AGENDA DOES
 *
 * The shelf works with no enrollment at all: look a book up, log pages, finish
 * it. This launcher exists only so that a shelf which HAS an obligation can
 * appear on the daily agenda, and it reads the same store the shelf writes.
 * Nothing below the seam knows an obligation exists — `bookShelf.mjs` measures
 * whatever it is handed and has no idea where the number came from.
 *
 * AND THAT IS NOW TRUE OF REACHABILITY TOO (2026-09-06). It used not to be:
 * `subjectsWithReadingShelf` read the enrollment, so only an enrolled child's
 * code named the program, and `appendAssignedProgramEntries` put the shelf in
 * the plan only from an enrollment — so the sentence above was true of the
 * STORE and false of the way in. In a household with one enrolled reader, three
 * children could not log a book at all. An enrollment now carries the
 * obligation and nothing else: `BuildAgenda` mints a reading code for every
 * learner, and `ResolveAccessCode` synthesizes a shelf entry when the plan
 * holds none. `status()` is unchanged and still answers `enrolled: false,
 * doneToday: true` for a learner with no enrollment — nothing is OWED, so
 * nothing appears on their agenda and nothing is scored.
 *
 * ## `doneToday` MEANS "NOTHING OWED TODAY"
 *
 * For a `day` window that is literal. For `week`, `month` and `once` it means
 * the target is already met, so nothing is owed right now. A weekly target read
 * as unmet on six days out of seven would put a permanent red tile on the board
 * for a child who is perfectly on track — which is worse than useless, because
 * it teaches everyone to ignore the colour.
 *
 * ## ONLY `once` CAN BE TERMINAL
 *
 * A finished series leaves the agenda, exactly as a `cadence: 'once'` program
 * does. Daily and weekly obligations are never terminal: tomorrow they ask
 * again, as story-time does.
 *
 * ## THREE ANSWERS, NOT TWO
 *
 * Enrolled, not enrolled, and UNREADABLE are distinguishable — the same care
 * `StoryTimeProgramLauncher` takes. An unreadable shelf is `error: true`, never
 * a zero, because a false zero shows a child who read four books as owing four
 * books and nothing anywhere reports it.
 *
 * @module applications/school/BookLogProgramLauncher
 */
import { BOOK_LOG_PROGRAM_ID, bookLogContext } from '#domains/school/bookLog.mjs';
import { measureObligation, projectShelfItem, selectFeaturedShelfItem } from '#domains/school/bookShelf.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

/** Where a child does this, in the words a child reads. */
const ON_THE_PANEL = 'on the school panel';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` shifted by whole days, without touching local time. */
function shiftDay(studyDay, days) {
  const at = Date.parse(`${studyDay}T00:00:00.000Z`);
  if (!Number.isFinite(at)) return studyDay;
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The window an obligation is measured over, ending on the current study day.
 * `once` is unbounded at the start: cumulative since the enrollment began.
 */
export function obligationWindow(per, studyDay) {
  if (per === 'once') return { from: null, to: studyDay };
  if (per === 'week') return { from: shiftDay(studyDay, -6), to: studyDay };
  if (per === 'month') return { from: shiftDay(studyDay, -29), to: studyDay };
  return { from: studyDay, to: studyDay };
}

export class BookLogProgramLauncher {
  #assignments; #bookLog; #timezone; #clock; #logger; #grants; #bookRepository;

  constructor({ assignments, bookLog, timezone = null, clock = () => new Date(), logger = console, grants = null, bookRepository = null } = {}) {
    if (!assignments || typeof assignments.get !== 'function') {
      throw new Error('BookLogProgramLauncher requires an assignments store with get(learnerId)');
    }
    if (!bookLog) throw new Error('BookLogProgramLauncher requires a bookLog store');
    this.#assignments = assignments;
    this.#bookLog = bookLog;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
    this.#grants = grants;
    // OPTIONAL ON PURPOSE. `schoolLifecycle.mjs` defaults it to null and only
    // builds `GetBookShelf` when a books API exists, so a household without
    // one must still get a card — titleless, but printed.
    this.#bookRepository = bookRepository;
  }

  get id() { return BOOK_LOG_PROGRAM_ID; }

  get locationHint() { return ON_THE_PANEL; }

  /** The panel hosts the shelf; DoNow can dispatch a child there. */
  get surface() { return 'portal'; }

  /** The single place the household's 4am boundary is applied for this program. */
  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  /**
   * THE one day function for this program. Every reader of the shelf — the
   * agenda through `status()`, the shelf route through its projection — must
   * count days with this, or the agenda and the card disagree on `daysRead`
   * for the same child. Applies the household's 4am boundary and timezone;
   * answers `''` for anything unparseable, which `inWindow` rejects.
   */
  dayOf(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? studyDayForInstant(ms, { timezone: this.#timezone }) : '';
  }

  /**
   * The shape `collectProgramStatuses` calls every launcher with. A bare
   * string is refused rather than looked up: on the old string shape a live
   * agenda call would have found nothing and reported a child as NOT
   * ENROLLED, which nothing anywhere would have flagged.
   *
   * @param {{userId: string, programInstance?: string|null}} args —
   *   `programInstance` is accepted and ignored; there is one shelf per learner.
   * @returns {Promise<object>} the shape `planDailyAgenda` consumes
   */
  async status({ userId } = {}) {
    const learnerId = userId;
    if (typeof learnerId !== 'string' || !learnerId) throw new TypeError('BookLogProgramLauncher.status takes { userId }');
    let enrollment;
    try {
      const assignment = await this.#assignments.get(learnerId);
      enrollment = (Array.isArray(assignment?.programs) ? assignment.programs : [])
        .find((entry) => entry?.programId === BOOK_LOG_PROGRAM_ID) ?? null;
    } catch (error) {
      this.#logger.warn?.('school.book-log.assignments-unreadable', { learnerId, error: error.message });
      return this.#unreadable();
    }

    if (!enrollment) {
      // NOT ENROLLED IS NOT "NO SHELF". The shelf is open to every learner —
      // an enrollment adds an OBLIGATION, it does not grant access (see this
      // file's header). So `doneToday: true` and `enrolled: false` keep the
      // row off the agenda, because nothing is owed, while `reopenable` and a
      // `context` still describe a shelf that can be opened and drawn.
      //
      // Without the context this branch answered a card with `course: null`,
      // which is the blank-artwork case the poster route exists to refuse.
      return {
        enrolled: false, error: false, doneToday: true, terminal: false,
        reopenable: true, context: bookLogContext(),
        progressLabel: null, score: null, obligationProgress: null,
      };
    }

    let items;
    try {
      items = (await this.#bookLog.listForLearner(learnerId)) ?? [];
    } catch (error) {
      this.#logger.warn?.('school.book-log.shelf-unreadable', { learnerId, error: error.message });
      return this.#unreadable();
    }

    const obligation = enrollment.obligation ?? null;
    const window = obligation ? obligationWindow(obligation.per, this.studyDay()) : null;
    const dayOf = (iso) => this.dayOf(iso);
    const measured = measureObligation(obligation, items, window, { dayOf });
    const projections = items.map((entry) => projectShelfItem(entry, { dayOf }));
    const reading = projections.filter((view) => view.status === 'reading').length;
    const finished = projections.filter((view) => view.status === 'finished').length;

    return {
      enrolled: true,
      error: false,
      // `null`, not `true`, when nothing is owed. The agenda treats `true` as
      // "subject served" (agenda.mjs:259), which closed the shelf to a child
      // with no target and hid every other English unit behind it.
      doneToday: obligation ? measured.met : null,
      // Only a cumulative target can ever be finished for good.
      terminal: Boolean(obligation) && obligation.per === 'once' && measured.met,
      // THE SHELF NEVER CLOSES. A met daily target means nothing is OWED; it
      // does not mean the child is finished with their books. They may want to
      // log the next twenty pages, finish the book, start another, or fix a
      // page they typed wrong — and a log that refuses entries after the first
      // one of the day is not a log.
      //
      // Without this, `doneToday: true` made the subject read as served and
      // the card came back "You already did this today." with nothing but Go
      // back: a child who read once in the morning could not record reading
      // again that evening. The typed reading code escaped it (its token
      // carries `continueToday`), so the failure only showed on the path with
      // no token — which is the one a grown-up looks at.
      //
      // A `once` obligation is the exception and is already `terminal` above:
      // a finished series really is done, and re-offering it forever is the
      // bug that `cadence: 'once'` exists to prevent.
      reopenable: !(Boolean(obligation) && obligation.per === 'once' && measured.met),
      // THE SHELF'S OWN TAXONOMY, so the card and the day row can name it and
      // draw its artwork. Without a `context` the projection passed the entry
      // through untouched, the card came out `course: null`, and the artwork
      // slot had nothing to resolve — which is why Reading was the one row on
      // the board with no picture and no course line.
      //
      // `program:book-log` is a SCHEME, not a course id. It is the same trick
      // `piano-course` already relies on with `plex:<ratingKey>`: a program
      // supplies an id in a vocabulary the poster resolvers understand. It is
      // deliberately NOT a curriculum course — a course with no units is what
      // the catalog gate exists to reject, and enrollment, progress and the
      // gradebook would all try to believe in it.
      //
      // "Independent study" is not invented copy: it is the wording the
      // printed agenda already uses for this row.
      context: bookLogContext(enrollment.title),
      // The shelf's obligation line adds the window word (`today`, `this
      // week`) client-side; `per` rides along so it can.
      obligationProgress: obligation ? { ...measured, per: obligation.per } : null,
      progressLabel: this.#label({ obligation, measured, reading, finished }),
      // A shelf is not graded. `null` is the honest answer, and the agenda
      // already understands it (a language ladder does not grade either).
      score: null,
      reading,
      finished,
    };
  }

  /**
   * What the printed agenda card headlines. NOT part of `status()`, and it must
   * not become part of it.
   *
   * `status()` runs inside `collectProgramStatuses`, which `PlanProjection`
   * calls for the teacher board, the status board, DoNow and the completion
   * recompute. A title is a per-book repository read; putting N of those behind
   * every one of those surfaces, to decorate one printed card, is a cost none of
   * them asked for. The agenda calls this once per learner; nothing else calls
   * it at all.
   *
   * It also does not consult the enrollment. Reading the log only for an
   * enrolled child would leave three of four learners with a bare box — the
   * shelf is open to everyone (see this file's header) and so is the card.
   *
   * ## BOOK FACTS ARE DECORATION
   *
   * A cold cache, a throwing repository, an ISBN that never resolved, or a
   * composition with no books API at all yields `book: null` and a titleless
   * card. Never fewer cards, and never a card claiming a book it could not name.
   * The bars, the page and the day count all come from the log itself and
   * survive every one of those. Only the LOG being unreadable changes the
   * answer, and that says `unreadable` rather than `empty`, because telling a
   * child with a full shelf that they have no books is a lie the card can avoid.
   *
   * @param {{userId: string}} args
   * @returns {Promise<{state: 'reading'|'finished'|'set-aside'|'empty'|'unreadable',
   *   book: {title: string|null, authors: string[], pageCount: number|null}|null,
   *   page: number|null, percent: number|null, minutes: number|null,
   *   daysRead: number, at: string|null, alsoReading: string[]}>}
   */
  async featuredBook({ userId } = {}) {
    const learnerId = userId;
    if (typeof learnerId !== 'string' || !learnerId) throw new TypeError('BookLogProgramLauncher.featuredBook takes { userId }');
    let items;
    try {
      items = (await this.#bookLog.listForLearner(learnerId)) ?? [];
    } catch (error) {
      this.#logger.warn?.('school.book-log.shelf-unreadable', { learnerId, error: error.message });
      return { state: 'unreadable', book: null, page: null, percent: null, minutes: null, daysRead: 0, at: null, alsoReading: [] };
    }

    const dayOf = (iso) => this.dayOf(iso);
    const { state, featured, alsoReading } = selectFeaturedShelfItem(items, { dayOf });
    if (!featured) {
      return { state, book: null, page: null, percent: null, minutes: null, daysRead: 0, at: null, alsoReading: [] };
    }

    const facts = await this.#bookFacts(featured.item.bookId, learnerId);
    const others = await Promise.all(alsoReading.map((entry) => this.#bookFacts(entry.item.bookId, learnerId)));

    return {
      state,
      book: facts,
      page: featured.projection.page,
      percent: featured.projection.percent,
      minutes: featured.projection.minutes,
      daysRead: featured.projection.daysRead,
      at: featured.projection.lastAt,
      alsoReading: others.map((book) => book?.title).filter(Boolean),
    };
  }

  /** Null on every failure. Decoration must never cost the card. */
  async #bookFacts(bookId, learnerId) {
    if (!this.#bookRepository?.findByIsbn) return null;
    try {
      const book = await this.#bookRepository.findByIsbn(bookId);
      return book ? { title: book.title ?? null, authors: book.authors ?? [], pageCount: book.pageCount ?? null } : null;
    } catch (error) {
      this.#logger.warn?.('school.book-log.book-facts-failed', { learnerId, bookId, error: error.message });
      return null;
    }
  }

  /**
   * There is nowhere to dispatch to yet — the shelf is a panel surface a child
   * walks up to. Refusing truthfully beats mounting a screen that is not there.
   */
  async launch() {
    return { ok: false, reason: `Your books are ${ON_THE_PANEL}.` };
  }

  /**
   * The signed handoff the panel mounts the shelf with (`RunSelfServiceAction`
   * spreads this into the mount effect). Routes verify `bookGrant` per request
   * and take the learner from it — never from the client (design §2). Same
   * pattern as `RubiksCubeProgramLauncher.issueLaunchTarget`.
   */
  issueLaunchTarget({ userId } = {}) {
    if (!this.#grants) throw new Error('BookLogProgramLauncher cannot issue a launch target without a grants issuer');
    return { kind: 'program', program: this.id, learnerId: userId, bookGrant: this.#grants.issue({ learnerId: userId }) };
  }

  #unreadable() {
    return {
      enrolled: null, error: true, doneToday: false, terminal: false,
      progressLabel: null, score: null, obligationProgress: null,
    };
  }

  #label({ obligation, measured, reading, finished }) {
    if (!obligation) {
      if (reading === 0 && finished === 0) return 'No books yet';
      const parts = [];
      if (reading) parts.push(`${reading} reading`);
      if (finished) parts.push(`${finished} finished`);
      return parts.join(' · ');
    }
    const unit = obligation.metric === 'checkins' ? 'check-in' : obligation.metric.replace(/s$/, '');
    const plural = measured.target === 1 ? unit : `${unit}s`;
    const scope = obligation.scope?.label ? ` of ${obligation.scope.label}` : '';
    return `${measured.actual} of ${measured.target} ${plural}${scope}`;
  }
}

export default BookLogProgramLauncher;
