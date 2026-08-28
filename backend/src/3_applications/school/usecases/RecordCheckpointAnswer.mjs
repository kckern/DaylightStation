/**
 * RecordCheckpointAnswer — grade one comprehension answer inside a playing
 * lesson, and release the gate when the checkpoint is fully answered.
 *
 * This is the answer end of the hard gate `DispatchMedia` opened: the media
 * paused at an authored position, the child was asked a question, and this is
 * what decides whether playback may resume. It sits beside `DispatchMedia` and
 * `RecordMediaCompletion` and is built the same way — `reduceSession` over the
 * session's own event log, one `createEvent` append, a `{status, message, …}`
 * answer a screen can render without interpreting an exception.
 *
 * ## The policy: RETRY UNTIL CORRECT (design D3)
 *
 * A wrong answer costs nothing durable and leaves the item answerable. That is
 * this use case's policy and it is deliberately NOT the policy `SchoolService`
 * imposes on the same grader (one shot, claim the response, move on) or the one
 * the OMR path imposes (a card is marked once, then a grown-up may override).
 * `2_domains/school/grading.mjs` stays policy-free and all three sequence it
 * differently. The reason this one retries is that the escape hatch offered
 * beside every wrong answer is "rewind and rewatch": a child who cannot answer
 * self-selects remediation instead of guessing, which only works if guessing is
 * never terminal.
 *
 * ## Legality: `transitionViolation`, never `statesAccepting`
 *
 * `checkpoint_cleared` is an ANNOTATION, and annotations are absent from
 * `TRANSITIONS` by construction — so `statesAccepting('checkpoint_cleared')`
 * answers with the EMPTY set and gating on it would refuse every clear this
 * use case could ever make. `transitionViolation` is the authority, and asking
 * it (rather than hardcoding the pair of states) means the domain table stays
 * the single place the answer lives: `media_dispatched` and `media_stalled`
 * today, and whatever it says tomorrow without a change here.
 *
 * A STALLED session clearing a checkpoint is the common case, not a loophole.
 * A 20-minute lesson with five gates, at a couple of minutes per gate while a
 * child thinks, runs past `duration + grace` and stalls while perfectly
 * healthy. Refusing there would throw away a correct answer and re-ask it after
 * the replay — the exact frustration this feature exists to remove.
 *
 * ## Where partial progress lives, and why it is allowed to be forgotten
 *
 * The durable record is `attempts` on the `checkpoint_cleared` event, written
 * once, when the whole checkpoint clears. But a checkpoint with three questions
 * has to remember which of the three have been answered BEFORE any event can be
 * written, and this feature deliberately has no store. Three options, and why
 * this one:
 *
 *   - **The caller tells us** — rejected outright. A hard gate cannot take the
 *     client's word for which questions it already got right; a page that
 *     posted `answered: [q1, q2]` alongside one correct answer would clear a
 *     three-question gate with one answer. That is precisely the skip this
 *     whole feature exists to prevent, and it would be undetectable afterwards.
 *   - **A `checkpoint_cleared` per answered item** — worse: the event is keyed
 *     by `checkpointId` and the reducer is first-write-wins, so the first item
 *     would OPEN THE GATE and the remaining questions would never be asked.
 *   - **In memory, here** (chosen). Per-item attempt counts and the set of
 *     items answered correctly live in this instance, keyed by session and
 *     checkpoint, bounded by `MAX_TRACKED_CHECKPOINTS` and `PROGRESS_TTL_MS`,
 *     and dropped the moment the checkpoint clears.
 *
 * The cost is explicit and accepted: **a restart, or a checkpoint left half
 * answered for hours, re-asks that checkpoint's questions from the top.** It
 * never clears anything early and never loses a CLEARED checkpoint, because
 * cleared checkpoints are in the event log. This is the same direction of
 * failure the domain already chose — `clearedSetFrom` degrades a malformed row
 * to "not cleared", i.e. ask again — and the same doctrine the design records
 * for the lesson session itself: the in-memory half dying on restart is
 * correct, the durable evidence is what must survive.
 *
 * ## What is NOT recorded
 *
 * A wrong answer appends nothing. There is no event type for it and inventing
 * one is out of scope, so the durable trace of a struggle is the inflated
 * `attempts` on the eventual clear (`attempts - items.length` is the number of
 * wrong answers the checkpoint cost). The per-answer detail goes to the log
 * store as `school.checkpoint.wrong`, which is where a parent asking "what
 * stumped them tonight?" can still find it.
 */
import { reduceSession, createEvent, transitionViolation } from '#domains/school/sessions/sessionEvents.mjs';
import { seekCeilingFor, clearedSetFrom } from '#domains/school/mediaCheckpoints.mjs';
import { gradeAnswer, givenShapeError } from '#domains/school/grading.mjs';

/**
 * How long a half-answered checkpoint is remembered. Generous next to the
 * minutes a real checkpoint takes, short next to "forever": a lesson abandoned
 * before dinner must not still be holding its half-answered gate at bedtime,
 * because the child who comes back to it is owed the questions again rather
 * than a gate that clears off yesterday's memory.
 */
const PROGRESS_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * A ceiling on the table, for the same reason `MAX_CHECKPOINTS` is a ceiling:
 * this is a household with a handful of children, so anything approaching this
 * many checkpoints in flight at once is a bug or a hostile caller, and either
 * way the right answer is to forget the oldest (re-ask it) rather than grow
 * without bound in a long-lived process.
 */
const MAX_TRACKED_CHECKPOINTS = 200;

/** Neither half can contain a NUL, so the key cannot be forged by collision. */
const progressKey = (sessionId, checkpointId) => `${sessionId}\u0000${checkpointId}`;

export class RecordCheckpointAnswer {
  static MAX_TRACKED_CHECKPOINTS = MAX_TRACKED_CHECKPOINTS;
  static PROGRESS_TTL_MS = PROGRESS_TTL_MS;

  #curriculum; #sessions; #bankReader; #clock; #logger;
  /** key -> { answered: Set<itemId>, attempts: Map<itemId, number>, total: number, touchedAt: number } */
  #progress = new Map();

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {{getBank: (id: string) => object}} deps.bankReader - the same
   *   surface `GradeSubmission` and `IssueDocument` take; `getBank` THROWS on an
   *   unknown id (see `SchoolService.getBank`), so every call here is guarded.
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ curriculum, sessions, bankReader, clock = () => new Date(), logger = console } = {}) {
    if (!curriculum || !sessions || !bankReader) {
      throw new Error('RecordCheckpointAnswer requires curriculum, sessions and bankReader');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#bankReader = bankReader;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** How many half-answered checkpoints are being remembered (a health read). */
  trackedCheckpointCount() { return this.#progress.size; }

  /**
   * Grade one answer at one checkpoint.
   *
   * @param {object} args
   * @param {string} args.sessionId
   * @param {string} args.checkpointId - `cp-<at>`, as authored on the unit
   * @param {string} args.itemId - one of that checkpoint's `items`
   * @param {*} args.given - the child's answer, in the shape the item's type takes
   * @returns {Promise<{ status: 'graded'|'already_cleared'|'not_playing'|'unknown_session'
   *                             |'not_gated'|'unknown_checkpoint'|'unknown_item'
   *                             |'invalid_answer'|'ungradable',
   *                     sessionId: string|null, checkpointId: string|null, itemId: string|null,
   *                     correct: boolean|null, attempts: number|null,
   *                     checkpointCleared: boolean, seekCeiling: number|null, message: string }>}
   *   `attempts` counts answers to THIS item (the one just graded included);
   *   the `attempts` written onto the event counts every answer the whole
   *   checkpoint cost.
   */
  async execute({ sessionId = null, checkpointId = null, itemId = null, given = null } = {}) {
    const nowIso = this.#clock().toISOString();
    this.#sweep();

    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) {
      return this.#refuse('unknown_session', { sessionId, checkpointId, itemId }, 'We could not find that lesson.');
    }
    // The domain table decides, not a list copied into this file.
    if (transitionViolation(state.state, 'checkpoint_cleared')) {
      return this.#refuse('not_playing', { sessionId, checkpointId, itemId }, 'That lesson is not playing right now.');
    }

    const unit = await this.#curriculum.getUnit(state.unitId);
    const checkpoints = Array.isArray(unit?.checkpoints) ? unit.checkpoints : null;
    if (!checkpoints) {
      this.#logger.warn?.('school.checkpoint.not-gated', { sessionId, unitId: state.unitId });
      return this.#refuse('not_gated', { sessionId, checkpointId, itemId }, 'This lesson does not ask any questions.');
    }

    const cleared = clearedSetFrom(state.clearedCheckpoints);
    const checkpoint = checkpoints.find((cp) => cp.id === checkpointId);
    if (!checkpoint) {
      return this.#refuse('unknown_checkpoint', { sessionId, checkpointId, itemId }, 'We do not know that question stop.');
    }
    // Idempotent, for the same reason the reducer is first-write-wins: the
    // screen may resend an answer whose reply it never saw, and the gate is
    // already open. Re-grading would inflate `attempts` for one right answer.
    if (cleared.has(checkpoint.id)) {
      return {
        status: 'already_cleared', sessionId, checkpointId: checkpoint.id, itemId,
        correct: null, attempts: null, checkpointCleared: true,
        seekCeiling: seekCeilingFor(checkpoints, cleared),
        message: 'You already answered that one. Keep watching!',
      };
    }
    if (!checkpoint.items.includes(itemId)) {
      return this.#refuse('unknown_item', { sessionId, checkpointId: checkpoint.id, itemId },
        'That question is not part of this stop.', seekCeilingFor(checkpoints, cleared));
    }

    const item = this.#findItem(unit, itemId, sessionId);
    if (!item) {
      return this.#refuse('ungradable', { sessionId, checkpointId: checkpoint.id, itemId },
        'We could not mark that one. Tell a grown-up.', seekCeilingFor(checkpoints, cleared));
    }

    // Shape before grading — and BEFORE an attempt is spent. A malformed body
    // is a client fault, never a child's wrong answer, and counting it would
    // put a bug on a learner's record.
    const shapeError = givenShapeError(item, given);
    if (shapeError) {
      this.#logger.warn?.('school.checkpoint.bad-shape', { sessionId, checkpointId: checkpoint.id, itemId, error: shapeError });
      return this.#refuse('invalid_answer', { sessionId, checkpointId: checkpoint.id, itemId },
        'We did not understand that answer. Try again.', seekCeilingFor(checkpoints, cleared));
    }

    let verdict;
    try {
      verdict = gradeAnswer(item, given);
    } catch (err) {
      // Publish-time validation should make this unreachable; a child in front
      // of a paused video is not the place to find out otherwise.
      this.#logger.error?.('school.checkpoint.grade-failed', { sessionId, checkpointId: checkpoint.id, itemId, error: err.message });
      return this.#refuse('ungradable', { sessionId, checkpointId: checkpoint.id, itemId },
        'We could not mark that one. Tell a grown-up.', seekCeilingFor(checkpoints, cleared));
    }

    const progress = this.#track(sessionId, checkpoint.id);
    const attempts = (progress.attempts.get(itemId) ?? 0) + 1;
    progress.attempts.set(itemId, attempts);
    progress.total += 1;

    if (!verdict.correct) {
      // Nothing durable: the item stays answerable, and the ceiling has not moved.
      this.#logger.info?.('school.checkpoint.wrong', {
        sessionId, unitId: state.unitId, checkpointId: checkpoint.id, itemId, attempts,
      });
      return {
        status: 'graded', sessionId, checkpointId: checkpoint.id, itemId,
        correct: false, attempts, checkpointCleared: false,
        seekCeiling: seekCeilingFor(checkpoints, cleared),
        message: 'Not quite — have another go.',
      };
    }

    progress.answered.add(itemId);
    const remaining = checkpoint.items.filter((id) => !progress.answered.has(id));
    if (remaining.length) {
      this.#logger.info?.('school.checkpoint.answered', {
        sessionId, checkpointId: checkpoint.id, itemId, attempts, remaining: remaining.length,
      });
      return {
        status: 'graded', sessionId, checkpointId: checkpoint.id, itemId,
        correct: true, attempts, checkpointCleared: false,
        seekCeiling: seekCeilingFor(checkpoints, cleared),
        message: remaining.length === 1 ? 'Right! One more question.' : `Right! ${remaining.length} more questions.`,
      };
    }

    const { errors, event } = createEvent({
      type: 'checkpoint_cleared', at: nowIso, sessionId,
      checkpointId: checkpoint.id, attempts: progress.total,
    });
    if (errors.length) throw new Error(`RecordCheckpointAnswer: could not record the clear: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);
    this.#progress.delete(progressKey(sessionId, checkpoint.id));

    // Re-read rather than patching the set in hand: the ceiling handed back
    // resumes a child's playback, so it is derived from what is actually on the
    // record — including a clear some other caller landed in between.
    const next = reduceSession(await this.#sessions.readEvents(sessionId));
    const seekCeiling = seekCeilingFor(checkpoints, clearedSetFrom(next.clearedCheckpoints));
    this.#logger.info?.('school.checkpoint.cleared', {
      sessionId, unitId: state.unitId, checkpointId: checkpoint.id, attempts: progress.total, seekCeiling,
    });
    return {
      status: 'graded', sessionId, checkpointId: checkpoint.id, itemId,
      correct: true, attempts, checkpointCleared: true, seekCeiling,
      message: 'Right! Back to the lesson.',
    };
  }

  /** The bank item, or null when the bank (or the item in it) has gone. */
  #findItem(unit, itemId, sessionId) {
    if (!unit?.bank) {
      this.#logger.error?.('school.checkpoint.no-bank', { sessionId, unitId: unit?.unitId ?? null });
      return null;
    }
    let bank;
    try {
      bank = this.#bankReader.getBank(unit.bank);
    } catch (err) {
      this.#logger.error?.('school.checkpoint.bank-unreadable', { sessionId, bankId: unit.bank, error: err.message });
      return null;
    }
    const item = (bank?.items ?? []).find((i) => i?.id === itemId) ?? null;
    if (!item) this.#logger.error?.('school.checkpoint.item-missing', { sessionId, bankId: unit.bank, itemId });
    return item;
  }

  #track(sessionId, checkpointId) {
    const key = progressKey(sessionId, checkpointId);
    const existing = this.#progress.get(key);
    const entry = existing ?? { answered: new Set(), attempts: new Map(), total: 0, touchedAt: 0 };
    entry.touchedAt = this.#clock().getTime();
    // Re-insert so Map iteration order stays least-recently-touched first,
    // which is what makes the eviction below drop the right entry.
    this.#progress.delete(key);
    this.#progress.set(key, entry);
    return entry;
  }

  /** Drop what has gone stale, then what does not fit. Oldest first, both times. */
  #sweep() {
    const cutoff = this.#clock().getTime() - PROGRESS_TTL_MS;
    for (const [key, entry] of this.#progress) {
      if (entry.touchedAt > cutoff) break; // insertion order is oldest-first
      this.#progress.delete(key);
    }
    while (this.#progress.size >= MAX_TRACKED_CHECKPOINTS) {
      const oldest = this.#progress.keys().next().value;
      if (oldest === undefined) break;
      this.#progress.delete(oldest);
    }
  }

  #refuse(status, { sessionId, checkpointId, itemId }, message, seekCeiling = null) {
    this.#logger.info?.('school.checkpoint.refused', { status, sessionId, checkpointId, itemId });
    return {
      status,
      sessionId: sessionId ?? null,
      checkpointId: checkpointId ?? null,
      itemId: itemId ?? null,
      correct: null,
      attempts: null,
      checkpointCleared: false,
      seekCeiling,
      message,
    };
  }
}

export default RecordCheckpointAnswer;
