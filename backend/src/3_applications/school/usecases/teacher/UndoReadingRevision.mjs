/**
 * UndoReadingRevision — take back one change, by making another one.
 *
 * Per reading, linear, and read from that reading's OWN `revisions` list: a
 * global undo across the shelf would let one grown-up rewind past another's
 * later edit on a different book (design §4).
 *
 * Undo is a verb, not a stack pointer. Undoing revision *n* computes its
 * inverse, applies it through the same writer every other verb uses, and
 * APPENDS a new revision saying so. Three things follow, and all three are the
 * point:
 *
 * - The history grows and never rewinds, so "who changed this and when"
 *   survives every correction of a correction.
 * - Undoing an undo is just another undo. Redo is not a separate concept — the
 *   console may LABEL it redo when the last revision is itself an undo, but
 *   the mechanism is one.
 * - An undo whose inverse makes the record smaller tells the child, with the
 *   same reason requirement as the original verb, because `applyReadingOperation`
 *   decides that from the operation and not from who asked for it.
 *
 * The gate is INHERITED from the verb being undone: undoing a move needs the
 * same `books.reading.reassign` step-up the move needed.
 *
 * **Three things it refuses by name**, and those refusals live in
 * `readingEdits.mjs#undoRefusal` because `GetLearnerReadings` SERVES them on
 * every revision — so the console shows the sentence rather than a button that
 * lies, and shows the same sentence this verb would have thrown:
 * - a revision another undo already inverted — undo the undo instead;
 * - a move the receiving child has logged against — the reading is theirs now,
 *   and rewinding it would delete their evidence;
 * - the opening of a reading, whose inverse is destroying the reading and the
 *   history with it. That is `DeleteReading`, it is a step-up, and it should
 *   be asked for by its own name.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import {
  ReadingEditContext, applyReadingOperation, assertFreshRevisions,
  GATE_ACTIONS, OPS, UNDO_VERB, undoRefusal,
} from './readingEdits.mjs';

export class UndoReadingRevision {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({ learnerId, readingId, revisionId, reason = null, by = null, pin = null, baseRevisionCount } = {}) {
    // The capability first, before anything is read: a refusal must not be
    // able to reveal whether this child has this reading. The INHERITED
    // action is asserted below, once the revision says which verb it was.
    this.#context.assert({ action: 'books.reading.undo', userId: by, pin, learnerId, readingId });

    const reading = await this.#context.reading(learnerId, readingId);
    assertFreshRevisions(reading, baseRevisionCount);
    const revisions = reading.revisions ?? [];
    const revision = revisions.find((row) => row?.id === revisionId);
    if (!revision) throw new EntityNotFoundError('reading revision', revisionId);

    // The three refusals, from the one function that also SERVES them on the
    // read (`GetLearnerReadings`). The console showed the sentence; this is
    // the same sentence, so the grown-up is not told two different things.
    const refusal = undoRefusal(reading, revision, {
      // The label only appears in the move refusal, and looking a book up is a
      // round trip: ask for it only when it can be part of the answer.
      ...(revision.op === OPS.READING_MOVE ? { label: await this.#context.label(reading) } : {}),
    });
    if (refusal) throw new ValidationError(refusal);

    const inverse = await this.#inverse(reading, revision, learnerId);
    this.#context.assert({
      op: revision.op, userId: by, pin, learnerId, readingId,
      ...(inverse.toLearnerId ? { extra: { toLearnerId: inverse.toLearnerId } } : {}),
    });

    return applyReadingOperation(this.#context, {
      learnerId, reading, by, pin, reason,
      verb: UNDO_VERB, undoes: revisionId, undoneVerb: revision.verb,
      ...inverse,
    });
  }

  /**
   * The inverse of one revision, in the same vocabulary the forward verbs use.
   *
   * `op` says what SHAPE the change was, which is why a revision written by
   * an undo inverts exactly like the verb it came from.
   */
  async #inverse(reading, revision, learnerId) {
    const { op, before, after } = revision;

    if (op === OPS.READING_UPDATE) {
      return { op: OPS.READING_UPDATE, patch: { ...before } };
    }

    if (op === OPS.ENTRY_ADD) {
      // The row was appended by the revision being undone; `after` is the row
      // the store actually stored, id included.
      return { op: OPS.ENTRY_DELETE, entryId: after?.id ?? null };
    }

    if (op === OPS.ENTRY_UPDATE) {
      const { id, ...patch } = before ?? {};
      return {
        op: OPS.ENTRY_UPDATE, entryId: id ?? after?.id ?? null, patch,
        // Judged on the window the day is landing IN, exactly as the forward
        // re-date was: an undo that pulls a day back into the counted week
        // makes the record bigger and says nothing.
        window: patch.on !== undefined ? await this.#context.countedWindow(learnerId) : null,
      };
    }

    if (op === OPS.ENTRY_DELETE) {
      const row = before ?? {};
      return {
        op: OPS.ENTRY_ADD,
        // Everything the row said, minus the id: the store mints entry ids and
        // never re-uses a removed one, so the restored day is the same
        // evidence under a new name. The revision records both.
        entry: {
          on: row.on ?? null, at: row.at ?? null,
          page: row.page ?? null, minutes: row.minutes ?? null,
          ...(row.note ? { note: row.note } : {}),
          source: row.source ?? 'teacher',
          idempotencyKey: row.idempotencyKey ?? null,
        },
      };
    }

    if (op === OPS.READING_MOVE) {
      // "Read against since it moved" was already refused above, by name.
      const home = before?.learnerId ?? null;
      if (!home) throw new ValidationError('that move does not say where the reading came from');
      return { op: OPS.READING_MOVE, toLearnerId: home };
    }

    throw new ValidationError(`that change cannot be undone: ${op ?? 'unknown'}`);
  }
}

export default UndoReadingRevision;
