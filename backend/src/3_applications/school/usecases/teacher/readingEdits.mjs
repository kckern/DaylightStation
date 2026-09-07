/**
 * The one place the teacher's reading verbs are described.
 *
 * Nine use cases sit on top of this, and each of them is a validator plus one
 * call to `applyReadingOperation`. The three rules that carry the surface
 * (teacher reading admin design §3, §4, §7) live HERE rather than being
 * restated per verb, because a second copy of "does the child hear about
 * this?" is a copy free to drift:
 *
 * 1. **Every write appends a revision.** `{id, by, at, verb, before, after,
 *    reason, toldChild}`, plus the `op` that says what SHAPE of change it was
 *    — which is what makes it invertible. History is how a grown-up accounts
 *    for a change and it is the only route back.
 * 2. **Five operations tell the child**, and the test is whether the CHILD'S
 *    OWN record got smaller: an entry deleted, a finish withdrawn, a day
 *    re-dated out of the counted window, a reading moved to a sibling, a
 *    reading destroyed. Those five require a reason and deliver it. Correcting
 *    an ISBN, a page count, a mode or a typo'd page says nothing, because
 *    there is nothing a child needs to know. A feed of "a grown-up fixed the
 *    page count" teaches a child to ignore the feed, and then the sentence
 *    that matters arrives in the same stream.
 * 3. **`baseRevisionCount` on every write.** The editor sends the length of
 *    the revisions list it loaded; a stale value is refused and NOTHING is
 *    written. Never merged. Two grown-ups on two devices is not hypothetical
 *    in this household (teacher.md invariant 5).
 *
 * Delivery goes through `RecordTeacherNote` and nothing else. It already
 * reaches both surfaces a child reads — the panel's Feedback list and the
 * agenda's "Notes for you" — it truncates at 240 characters, and it asserts
 * its own `note.send` gate, which runs on the capability cookie. That last
 * part matters for the two step-up verbs: their grant is one-use and is spent
 * by the reading action itself, so the note must not need a second one.
 *
 * @module applications/school/usecases/teacher/readingEdits
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { StateConflictError } from '#apps/common/errors/SemanticErrors.mjs';
import { inDayWindow } from '#domains/school/bookShelf.mjs';
import { obligationWindow } from '#apps/school/BookLogProgramLauncher.mjs';

/** What a revision says happened. Also the id of its inverse rule. */
export const OPS = Object.freeze({
  READING_UPDATE: 'reading.update',
  READING_ADD: 'reading.add',
  READING_DELETE: 'reading.delete',
  READING_MOVE: 'reading.move',
  ENTRY_ADD: 'reading.entry.add',
  ENTRY_UPDATE: 'reading.entry.update',
  ENTRY_DELETE: 'reading.entry.delete',
});

/** The verb an undo records. The op it applied rides alongside it. */
export const UNDO_VERB = 'reading.undo';

/**
 * The gate each operation runs on. Two of them are step-ups
 * (`TeacherCapabilitySessions.mjs#STEP_UP_ACTIONS`), and both are scoped to
 * the reading id — which is why every assert below passes `readingId` in its
 * context whether or not the action needs it.
 */
export const GATE_ACTIONS = Object.freeze({
  [OPS.READING_UPDATE]: 'books.reading.update',
  [OPS.READING_ADD]: 'books.reading.add',
  [OPS.READING_DELETE]: 'books.reading.delete',
  [OPS.READING_MOVE]: 'books.reading.reassign',
  [OPS.ENTRY_ADD]: 'books.reading.entry.add',
  [OPS.ENTRY_UPDATE]: 'books.reading.entry.update',
  [OPS.ENTRY_DELETE]: 'books.reading.entry.delete',
});

/** The three states the console offers. `unread` is a store value, not a verb. */
export const TEACHER_STATUSES = Object.freeze(['reading', 'finished', 'set-aside']);

/** The reading's flat, teacher-facing fields, and where each lives in the store. */
const FLAT_FIELDS = Object.freeze({
  isbn: (reading) => reading?.book?.isbn ?? null,
  pageCount: (reading) => reading?.book?.pageCount ?? null,
  progressMode: (reading) => reading?.progressMode ?? null,
  status: (reading) => reading?.status ?? null,
  finishedOn: (reading) => reading?.finishedOn ?? null,
});

export const isBlank = (value) => typeof value !== 'string' || !value.trim();

/**
 * A stale save is refused, never merged (teacher.md invariant 5).
 *
 * Required, not optional: this is a new surface with no deployed client, and
 * "what did you load?" is the only question that makes two grown-ups on two
 * devices safe. `AddReadingForLearner` is the one verb it cannot apply to —
 * nothing was loaded, because the reading does not exist yet.
 */
export function assertFreshRevisions(reading, baseRevisionCount) {
  if (!Number.isInteger(baseRevisionCount) || baseRevisionCount < 0) {
    throw new ValidationError('baseRevisionCount is required — send the length of the revisions list you loaded');
  }
  const current = Array.isArray(reading?.revisions) ? reading.revisions.length : 0;
  if (current !== baseRevisionCount) {
    throw new StateConflictError(
      'This reading changed since you loaded it — reload and try again.',
      { code: 'STALE_SAVE' },
    );
  }
}

/** The sentences a child reads. Composed, because 240 characters is the budget. */
export const readingNotes = {
  entryDeleted: ({ label, on, reason }) => `A grown-up removed the reading day ${on} from ${label} — ${reason}`,
  entryRedated: ({ label, from, to, reason }) => `A grown-up moved a reading day on ${label} from ${from} to ${to} — ${reason}`,
  unfinished: ({ label, reason }) => `A grown-up marked ${label} as not finished yet — ${reason}`,
  movedAway: ({ label, reason }) => `${label} was moved off your shelf to the person who read it — ${reason}`,
  movedHere: ({ label, reason }) => `${label} was added to your shelf — it had been logged on someone else's — ${reason}`,
  readingDeleted: ({ label, reason }) => `A grown-up removed ${label} from your shelf — ${reason}`,
};

/** What to call a book in a sentence somebody reads. Never the raw record. */
export const bookLabel = (book, isbn) => book?.title || (isbn ? `book ${isbn}` : 'a book');

/**
 * The three undos that are refused by name, in the server's own words.
 *
 * ONE implementation, two readers: `UndoReadingRevision` throws these, and
 * `GetLearnerReadings` serves them on the revision so the console can render
 * the sentence instead of a button that would fail. A console holding its own
 * copy of these words meant a grown-up read one sentence before tapping and
 * another after, and only one of them was true.
 *
 * @param {object} reading - the reading, with its `entries` and `revisions`
 * @param {object} revision - the row being asked about
 * @param {{label?: string}} names - what to call the book
 * @returns {string|null} the refusal, or null if this revision can be undone
 */
export function undoRefusal(reading, revision, { label = 'This book' } = {}) {
  if (!revision) return null;
  const revisions = Array.isArray(reading?.revisions) ? reading.revisions : [];

  // Linear, per reading: a revision a later undo already inverted must not be
  // inverted twice. Undoing the undo is the way back.
  if (revisions.some((row) => row?.undoes === revision.id)) {
    return 'That change has already been undone — undo the undo instead.';
  }

  // The inverse of opening a reading is destroying it. That is `DeleteReading`,
  // it is a step-up, and it should be asked for by its own name.
  if (revision.op === OPS.READING_ADD) {
    return 'Undoing the opening of a reading would destroy it and its whole history. Delete the reading instead, which says what it is.';
  }

  if (revision.op === OPS.READING_MOVE) {
    // The reading is theirs now; rewinding it would delete their evidence.
    const since = (reading?.entries ?? [])
      .filter((entry) => String(entry?.at ?? '') > String(revision.at ?? '')).length;
    if (since > 0) {
      return `${label} has been read since it moved — undoing would delete that reading. Move it back instead, which keeps the days.`;
    }
  }

  return null;
}

/**
 * Everything the verbs share: the store, the gate, the note path, the clock
 * and the book facts. Held by each use case rather than inherited, so a use
 * case's own dependencies stay visible in its constructor.
 */
export class ReadingEditContext {
  #bookLog; #teacherGate; #recordTeacherNote; #bookRepository; #bookLogLauncher;
  #clock; #idGen; #logger;

  constructor({
    bookLog, teacherGate, recordTeacherNote = null, bookRepository = null,
    bookLogLauncher = null, clock = () => new Date(),
    idGen = () => `rev_${Math.random().toString(36).slice(2, 10)}`, logger = console,
  } = {}) {
    if (!bookLog) throw new Error('a teacher reading verb requires bookLog');
    if (!teacherGate) throw new Error('a teacher reading verb requires teacherGate');
    this.#bookLog = bookLog;
    this.#teacherGate = teacherGate;
    this.#recordTeacherNote = recordTeacherNote;
    this.#bookRepository = bookRepository;
    this.#bookLogLauncher = bookLogLauncher;
    this.#clock = clock;
    this.#idGen = idGen;
    this.#logger = logger;
  }

  get bookLog() { return this.#bookLog; }

  get logger() { return this.#logger; }

  now() { return this.#clock().toISOString(); }

  /**
   * The gate FIRST, before anything is read: a refusal must not be able to
   * reveal whether the child has this reading at all.
   */
  assert({ op, action = null, userId = null, pin = null, learnerId, readingId = null, extra = null }) {
    this.#teacherGate.assert({
      userId: userId ?? null,
      pin: pin ?? null,
      action: action ?? GATE_ACTIONS[op],
      context: { learnerId, ...(readingId ? { readingId } : {}), ...(extra ?? {}) },
    });
  }

  /** One reading, or an honest 404. */
  async reading(learnerId, readingId) {
    if (isBlank(learnerId)) throw new ValidationError('learnerId is required');
    if (isBlank(readingId)) throw new ValidationError('readingId is required');
    const found = (await this.#bookLog.listForLearner(learnerId) ?? [])
      .find((row) => row?.id === readingId);
    if (!found) throw new EntityNotFoundError('reading', readingId);
    return found;
  }

  /** What to call the book in a sentence a child reads. */
  async label(reading) {
    const isbn = reading?.book?.isbn ?? null;
    return bookLabel(await this.facts(isbn), isbn);
  }

  /** Book facts for a read, never invented: nulls where the API is not wired. */
  async facts(isbn) {
    if (!this.#bookRepository || !isbn) return null;
    try {
      return await this.#bookRepository.findByIsbn(isbn);
    } catch (error) {
      this.#logger.warn?.('school.teacher-reading.book-facts-failed', { isbn, error: error.message });
      return null;
    }
  }

  /**
   * The window the obligation is measured over, in the THREE answers a reader
   * has to be able to tell apart:
   *
   * - `window` — there is one, and here it is;
   * - `none` — this child owes no reading, so no day can drop out of a count;
   * - `unknown` — the obligation could not be read (or no launcher is wired).
   *
   * `none` and `unknown` both mean "no window to judge against", and the write
   * path treats them identically — but a CONSOLE that cannot tell them apart
   * silently stops asking for a reason it should still be asking for, and says
   * nothing about why. Hence the state, served rather than inferred from a
   * missing field.
   */
  async countedWindowView(learnerId) {
    const unknown = { state: 'unknown', per: null, from: null, to: null };
    if (!this.#bookLogLauncher) return unknown;
    try {
      const status = await this.#bookLogLauncher.status({ userId: learnerId });
      const per = status?.obligationProgress?.per ?? null;
      if (!per) return { state: 'none', per: null, from: null, to: null };
      const { from = null, to = null } = obligationWindow(per, this.#bookLogLauncher.studyDay()) ?? {};
      return { state: 'window', per, from, to };
    } catch (error) {
      this.#logger.warn?.('school.teacher-reading.obligation-unreadable', { learnerId, error: error.message });
      return unknown;
    }
  }

  /** The household's study day, or null where no launcher is wired. */
  studyDay() {
    try {
      return this.#bookLogLauncher?.studyDay?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Just the bounds, for the write path that judges whether a re-date leaves
   * them. One derivation, two readers: `countedWindowView` is what the console
   * is served and this is what `leavesWindow` is handed.
   */
  async countedWindow(learnerId) {
    const view = await this.countedWindowView(learnerId);
    return view.state === 'window' ? { from: view.from, to: view.to } : null;
  }

  /**
   * Deliver one sentence to one child, and answer whether it landed.
   *
   * The answer is what `toldChild` is set from. An edit whose note failed must
   * not be recorded as having told anyone — the history would then be the only
   * record of a conversation that never happened.
   */
  async tell({ learnerId, note, from, pin }) {
    if (!this.#recordTeacherNote) {
      this.#logger.warn?.('school.teacher-reading.note-undeliverable', { learnerId, reason: 'not configured' });
      return false;
    }
    try {
      await this.#recordTeacherNote.execute({ learnerId, note, from: from ?? null, pin: pin ?? null });
      return true;
    } catch (error) {
      this.#logger.warn?.('school.teacher-reading.note-failed', { learnerId, error: error.message });
      return false;
    }
  }

  revision({ verb, op, by, before, after, reason, toldChild, undoes = null, undoneVerb = null }) {
    return {
      id: this.#idGen(),
      by: by ?? null,
      at: this.now(),
      verb,
      op,
      before: before ?? null,
      after: after ?? null,
      reason: isBlank(reason) ? null : reason.trim(),
      toldChild: Boolean(toldChild),
      ...(undoes ? { undoes, undoneVerb } : {}),
    };
  }
}

/** The teacher-facing view of a reading's own fields, for `before`. */
export function flatten(reading, fields) {
  return Object.fromEntries(fields.map((field) => [field, FLAT_FIELDS[field](reading)]));
}

/** Map the flat, teacher-facing patch onto the store's own shape. */
export function toStorePatch(flat) {
  const patch = {};
  const book = {};
  if (flat.isbn !== undefined) book.isbn = flat.isbn;
  if (flat.pageCount !== undefined) book.pageCount = flat.pageCount;
  if (Object.keys(book).length) patch.book = book;
  for (const field of ['progressMode', 'status', 'finishedOn', 'openedOn']) {
    if (flat[field] !== undefined) patch[field] = flat[field];
  }
  return patch;
}

/** Did this reading stop being finished? That is the only shrinking state change. */
export const unfinishes = (reading, flat) => reading?.status === 'finished'
  && flat.status !== undefined && flat.status !== 'finished';

/** Did a re-date carry the day out of the window the obligation counts? */
export const leavesWindow = (window, before, after) => Boolean(window)
  && inDayWindow(before, window) && !inDayWindow(after, window);

/**
 * Apply ONE operation to one reading: decide whether the child hears about it,
 * deliver the sentence, mint the revision, and hand both to the store.
 *
 * The single writer for every verb AND for undo, which is why undoing a
 * deletion tells the child exactly what the deletion would have, and why
 * "history grows and never rewinds" is true by construction rather than by
 * discipline: nothing here removes a revision.
 *
 * The note is attempted BEFORE the write so `toldChild` states what actually
 * happened. A notes store that is down does not block a correction a grown-up
 * needs to make — it makes the history say, honestly, that nobody was told.
 *
 * @returns {Promise<{revision: object, result: object}>}
 */
export async function applyReadingOperation(context, {
  learnerId, reading, op, verb = op, by = null, pin = null, reason = null,
  patch = null, entry = null, entryId = null, toLearnerId = null,
  window = null, undoes = null, undoneVerb = null,
}) {
  const plan = await planOperation(context, {
    learnerId, reading, op, patch, entry, entryId, toLearnerId, window, reason,
  });

  if (plan.tells.length && isBlank(reason)) {
    throw new ValidationError(`${plan.why} — a reason is required, and the child is told`);
  }

  let toldChild = false;
  if (plan.tells.length) {
    const delivered = [];
    for (const message of plan.tells) {
      // Sequential on purpose: two notes about one move should land in the
      // order the sentence describes, and a shared notes file is one writer.
      delivered.push(await context.tell({ ...message, from: by, pin }));
    }
    toldChild = delivered.every(Boolean);
  }

  const revision = context.revision({
    verb, op, by, before: plan.before, after: plan.after, reason, toldChild, undoes, undoneVerb,
  });
  const result = await plan.write(revision);
  return { revision, result };
}

/**
 * What the operation changes, who hears about it, and how to write it.
 *
 * Split out from the applier so the decision ("does this shrink the child's
 * record?") is one readable table rather than five branches interleaved with
 * store calls.
 */
async function planOperation(context, {
  learnerId, reading, op, patch, entry, entryId, toLearnerId, window, reason,
}) {
  const readingId = reading?.id ?? null;
  const label = await context.label(reading);
  const store = context.bookLog;

  if (op === OPS.READING_UPDATE) {
    const fields = Object.keys(patch);
    const before = flatten(reading, fields);
    const shrinks = unfinishes(reading, patch);
    return {
      before, after: { ...patch },
      why: shrinks ? `${label} would stop counting as finished` : null,
      tells: shrinks ? [{ learnerId, note: readingNotes.unfinished({ label, reason }) }] : [],
      write: (revision) => store.updateReading({
        learnerId, readingId, patch: toStorePatch(patch), revision,
      }),
    };
  }

  if (op === OPS.ENTRY_ADD) {
    return {
      before: null, after: { ...entry }, why: null, tells: [],
      write: async (revision) => {
        const stored = await store.appendEntry({ learnerId, readingId, ...entry });
        // `appendEntry` takes no revision — the row it writes is evidence, not
        // an edit to the reading. So the revision rides a no-op patch on the
        // reading it belongs to (`assertPatch` refuses an empty one, and
        // re-asserting `status` changes nothing). Without this the one verb
        // that ADDS evidence would be the one verb with no history.
        revision.after = { ...stored };
        await store.updateReading({
          learnerId, readingId, patch: { status: reading.status }, revision,
        });
        return stored;
      },
    };
  }

  if (op === OPS.ENTRY_UPDATE) {
    const row = (reading.entries ?? []).find((candidate) => candidate?.id === entryId);
    if (!row) throw new EntityNotFoundError('reading entry', entryId);
    const before = Object.fromEntries(Object.keys(patch).map((field) => [field, row[field] ?? null]));
    const shrinks = patch.on !== undefined && leavesWindow(window, row.on, patch.on);
    return {
      before: { ...before, id: entryId }, after: { ...patch, id: entryId },
      why: shrinks ? `moving that day out of ${label}'s counted window takes it off the child's total` : null,
      tells: shrinks
        ? [{ learnerId, note: readingNotes.entryRedated({ label, from: row.on, to: patch.on, reason }) }]
        : [],
      write: (revision) => store.updateEntry({ learnerId, readingId, entryId, patch, revision }),
    };
  }

  if (op === OPS.ENTRY_DELETE) {
    const row = (reading.entries ?? []).find((candidate) => candidate?.id === entryId);
    if (!row) throw new EntityNotFoundError('reading entry', entryId);
    return {
      before: { ...row }, after: null,
      why: `removing a reading day from ${label} makes the child's record smaller`,
      tells: [{ learnerId, note: readingNotes.entryDeleted({ label, on: row.on, reason }) }],
      write: (revision) => store.deleteEntry({ learnerId, readingId, entryId, revision }),
    };
  }

  if (op === OPS.READING_MOVE) {
    return {
      before: { learnerId }, after: { learnerId: toLearnerId },
      why: `${label} would leave this child's shelf`,
      tells: [
        { learnerId, note: readingNotes.movedAway({ label, reason }) },
        { learnerId: toLearnerId, note: readingNotes.movedHere({ label, reason }) },
      ],
      write: (revision) => store.moveReading({ learnerId, readingId, toLearnerId, revision }),
    };
  }

  if (op === OPS.READING_DELETE) {
    return {
      before: { ...reading }, after: null,
      why: `${label} and everything logged against it would be destroyed`,
      tells: [{ learnerId, note: readingNotes.readingDeleted({ label, reason }) }],
      // Nothing survives to append the revision TO. It comes back to the caller
      // and is logged; that is the whole trail there can be, which is also why
      // a delete is the one verb that cannot be undone.
      write: () => store.deleteReading({ learnerId, readingId }),
    };
  }

  throw new ValidationError(`unknown reading operation: ${op}`);
}

export default applyReadingOperation;
