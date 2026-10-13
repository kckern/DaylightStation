/**
 * GetPianoLessonGate — "does this learner owe a piano lesson right now, and
 * which one?", for the piano kiosk's menu.
 *
 * THE RULE HAS ONE OWNER. Every question this answers —
 * is the day discharged, what is the next playable lesson, does a co-progress
 * lock or a parent bypass settle it — is already answered by
 * `PianoCourseProgramLauncher.status()`, which the agenda and the completion
 * ceremony also read. This use case only chooses enrollments and shapes a
 * kiosk-facing payload; it must never re-derive a completion rule of its own,
 * or the menu and the agenda would eventually disagree about the same day.
 *
 * IT FAILS OPEN, DELIBERATELY. Any read that does not resolve — no assignment
 * file, an unreachable Plex, a launcher error — returns NOT gated. The gate
 * hides the entire kiosk menu, so a wrong `true` locks a child out of every
 * mode over a transient network fault, while a wrong `false` merely fails to
 * nag them about a lesson. Only the second is acceptable. (Contrast
 * `GetPlayableUnits.#assignedLessonId`, which fails CLOSED: that guard decides
 * whether to override sibling pacing, where the safe default is the opposite.)
 *
 * `reason` is diagnostic — for logs, tests and the teacher panel's status
 * line. The kiosk branches on `gated` alone.
 *
 * THE VERDICT IS MEMOISED PER LEARNER, AND THE MEMO IS EVENT-DRIVEN. Measured
 * against prod 2026-09-01, one verdict cost 11.1s cold and 0.35s warm: the
 * launcher's `status()` reaches `GetPlayableUnits` -> Plex, once per enrolled
 * course. The kiosk asks on every learner pick, so a child tapping through
 * their own name three times paid for three reads of the same answer.
 *
 * FRESHNESS COMES FROM INVALIDATION, NOT FROM THE TTL. Every input that can
 * change whether a learner owes a lesson — a completion, a passed challenge,
 * a parent bypass, an assignment edit — arrives on
 * `onCompletionInputChanged`, and drops that learner's entry. `MEMO_TTL_MS`
 * is only the backstop for what no event announces: a dropped bus message, a
 * plan file edited on disk, an episode added to the Plex course, and the 4am
 * study-day rollover. Sixty seconds bounds ALL of those by construction —
 * whatever goes stale, it self-heals inside a minute.
 *
 * `unavailable` IS NEVER MEMOISED. It is the fail-open answer for a broken
 * read, so caching it would take a one-second Plex blip and hold the gate
 * open for the rest of the minute. It is the one verdict worth re-paying for.
 *
 * @module applications/school/usecases/GetPianoLessonGate
 */
const SCHEMA = 'school.piano-lesson-gate/v1';

function sampledWarning(logger, event, data) {
  if (typeof logger?.sampled === 'function') {
    logger.sampled(event, data, { maxPerMinute: 1, aggregate: true, level: 'warn' });
  } else logger?.warn?.(event, data);
}

/**
 * The daily video cap, per enrollment.
 *
 * `gated` means "you still owe today's lesson" and funnels the kiosk INTO a
 * lesson video. This is the opposite end of the same day — "you have had
 * enough" — so it cannot ride on `gated`: the menu would try to launch a lesson
 * at the learner it is trying to stop. It is its own field, and the kiosk's
 * Videos mode is its only subject.
 *
 * THE COUNTER IS `completedLessonsToday`, deliberately. That is the same array
 * the launcher maps into `servedWork`. The agenda status board draws the first
 * completion as the assigned program disc and the remainder as its `+N` badge,
 * so the completed count remains visible without pretending every extra lesson
 * was another assignment. Counting watch events, sessions, or launches instead
 * would let the board and the cap disagree about the same day.
 *
 * OPTIONAL AND OFF BY DEFAULT: only an enrollment carrying a positive whole
 * `videosLockedAfter` is capped. A zero, a negative, a fraction or a string is
 * ignored rather than guessed at — a mistyped cap that silently became 0 would
 * lock a child out of videos permanently, which is the worst reading of an
 * ambiguous config.
 */
const OPEN = Object.freeze({ locked: false, reason: 'no-cap', completedToday: 0, cap: null });

function videoCapFor(row) {
  const cap = row?.videosLockedAfter;
  return Number.isInteger(cap) && cap > 0 ? cap : null;
}

function videoVerdict(row, status) {
  const cap = videoCapFor(row);
  const completedToday = Array.isArray(status?.completedLessonsToday)
    ? status.completedLessonsToday.length : 0;
  if (cap === null) return { locked: false, reason: 'no-cap', completedToday, cap: null };
  return completedToday >= cap
    ? { locked: true, reason: 'daily-cap', completedToday, cap }
    : { locked: false, reason: 'under-cap', completedToday, cap };
}

/**
 * The strictest lock wins, matching how `gated` already treats multiple piano
 * enrollments. A capped enrollment outranks an uncapped one even when open, so
 * the payload carries the cap the learner is actually running against rather
 * than whichever course happened to be listed first.
 */
function strictestVideoVerdict(candidates) {
  if (!candidates.length) return { ...OPEN };
  return candidates.find((v) => v.locked)
    ?? candidates.find((v) => v.cap !== null)
    ?? candidates.reduce((a, b) => (b.completedToday > a.completedToday ? b : a));
}

export class GetPianoLessonGate {
  /** Backstop only — see the class doc. Invalidation is what keeps this fresh. */
  static MEMO_TTL_MS = 60_000;

  /**
   * The memo is keyed by whatever `:learnerId` the kiosk put in the URL, which
   * is unvalidated input: a typo, a retired roster id or a crawler can each
   * mint an entry that no event will ever invalidate. Bounded here rather than
   * by trusting the caller — the working set is one household's children, so
   * anything past this many keys is noise, and evicting the oldest costs at
   * most one re-read of a learner nobody is currently looking at.
   */
  static MEMO_MAX_ENTRIES = 64;

  #assignments; #launcher; #realtime; #clock; #logger; #memo; #unsubscribe;

  /**
   * @param {object} config
   * @param {{get: Function}} config.assignments - School's learner assignment store
   * @param {{id: string, status: Function}} config.launcher - PianoCourseProgramLauncher
   * @param {import('../ports/ISchoolRealtimeGateway.mjs').ISchoolRealtimeGateway|null} [config.realtime]
   *   - source of memo invalidation; without it the TTL alone bounds staleness.
   * @param {() => (Date|number)} [config.clock]
   * @param {object} [config.logger]
   */
  constructor({ assignments, launcher, realtime = null, clock = () => new Date(), logger = console } = {}) {
    if (!assignments || !launcher) throw new Error('GetPianoLessonGate requires assignments and launcher');
    this.#assignments = assignments;
    this.#launcher = launcher;
    this.#realtime = realtime;
    this.#clock = clock;
    this.#logger = logger;
    this.#memo = new Map();
    this.#unsubscribe = null;
  }

  /**
   * Subscribe the memo to the facts that can change a verdict. Safe to call
   * more than once, and a no-op without a realtime gateway — the composition
   * wires one only when a bus exists, and the TTL still bounds staleness.
   */
  start() {
    if (this.#unsubscribe) return;
    if (typeof this.#realtime?.onCompletionInputChanged !== 'function') return;
    const unsubscribe = this.#realtime.onCompletionInputChanged((fact) => {
      // The gateway normalises the learner out of each wire shape and drops
      // the ones that carry none, so `learnerId` is present today. This line
      // is nonetheless the LIVE caller of the clear-all form: any future bus
      // source that omits the field lands here with `undefined` and flushes
      // the whole memo. That is the deliberate fail direction —
      // over-invalidating costs one re-read, under-invalidating leaves a child
      // gated against work they have already finished.
      this.invalidate(fact?.learnerId);
    });
    this.#unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {};
  }

  /** Unsubscribe. Safe before `start()` and safe to call twice. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /**
   * Forget one learner's verdict, or every learner's when called with nothing.
   * The no-argument form is not a test-only escape hatch: `start()`'s handler
   * reaches it whenever an event names no learner (see there).
   */
  invalidate(learnerId = null) {
    if (learnerId == null) this.#memo.clear();
    else this.#memo.delete(learnerId);
  }

  /**
   * @param {{learnerId: string}} params
   * @returns {Promise<{schema: string, learnerId: string, gated: boolean, reason: string,
   *   course?: object, unit?: object|null, lesson?: object}>}
   */
  async execute({ learnerId } = {}) {
    const base = { schema: SCHEMA, learnerId: learnerId ?? null };
    // Guest is the dismiss-outcome identity and has no roster-backed School
    // record to owe anything against.
    if (!learnerId || learnerId === 'guest') {
      return { ...base, gated: false, reason: 'guest', videos: { ...OPEN } };
    }

    const hit = this.#memo.get(learnerId);
    if (hit && this.#nowMs() - hit.at < GetPianoLessonGate.MEMO_TTL_MS) return { ...hit.result };

    let programs;
    try {
      programs = (await this.#assignments.get(learnerId))?.programs ?? [];
    } catch (err) {
      this.#logger.warn?.('school.piano-gate.assignments-unavailable', {
        learnerId, error: err?.message ?? String(err),
      });
      return this.#remember(learnerId, { ...base, gated: false, reason: 'unavailable', videos: { ...OPEN } });
    }

    const enrollments = programs.filter((row) => row?.programId === this.#launcher.id);
    if (!enrollments.length) {
      return this.#remember(learnerId, { ...base, gated: false, reason: 'not-enrolled', videos: { ...OPEN } });
    }

    // Accumulated across enrollments so every exit below can carry a verdict.
    // A fail-open exit carries the OPEN default rather than a partial count:
    // a cap derived from a read that did not resolve is not a measurement.
    const videoCandidates = [];

    // More than one piano course is unusual but legal: gated while ANY is
    // owed, showing the first owed lesson found.
    let reason = 'done';
    for (const row of enrollments) {
      // eslint-disable-next-line no-loop-func -- reads only this iteration's row
      const capThis = (status) => videoCandidates.push(videoVerdict(row, status));
      const courseId = row.courseId ?? row.corpusId ?? null;
      if (!courseId) continue;

      let status;
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential by design: the
        // first owed enrollment wins and the rest need not be read at all.
        status = await this.#launcher.status({ userId: learnerId, programInstance: courseId });
      } catch (err) {
        sampledWarning(this.#logger, 'school.piano-gate.status-failed', {
          learnerId, courseId, error: err?.message ?? String(err),
        });
        return this.#remember(learnerId, { ...base, gated: false, reason: 'unavailable', videos: { ...OPEN } });
      }

      if (status?.error === true) {
        sampledWarning(this.#logger, 'school.piano-gate.status-unavailable', { learnerId, courseId });
        return this.#remember(learnerId, { ...base, gated: false, reason: 'unavailable', videos: { ...OPEN } });
      }

      capThis(status);

      if (status.doneToday === true) {
        reason = status.bypassed ? 'bypassed' : status.excused ? 'excused' : 'done';
        continue;
      }

      // Owed, and there is something to hand them.
      if (status.nextLesson) {
        return this.#remember(learnerId, {
          ...base,
          gated: true,
          reason: 'owed',
          videos: strictestVideoVerdict(videoCandidates),
          ...this.#target(status.nextLesson),
          // This is an already-authorized, narrow descriptor produced by the
          // School launcher.  The kiosk may render it, but it may not infer a
          // challenge from the course lesson or manufacture its own ask.
          ...(status.challenge ? { challenge: status.challenge } : {}),
        });
      }

      // Owed nothing: every lesson is watched, so the course is finished and
      // there is no card to show. Not a gate, and not an error either.
      reason = 'course-complete';
    }

    return this.#remember(learnerId, {
      ...base, gated: false, reason, videos: strictestVideoVerdict(videoCandidates),
    });
  }

  /**
   * Store a verdict and hand back a COPY, never the stored object: the memo
   * outlives the request, and a caller that edited what it was given would be
   * editing the next caller's answer (the same aliasing hazard
   * `FitnessPlayableService.#detach` exists for one layer down).
   */
  #remember(learnerId, result) {
    // The fail-open answer is deliberately not cached — see the class doc.
    if (result.reason === 'unavailable') return result;
    this.#evict();
    this.#memo.set(learnerId, { at: this.#nowMs(), result });
    return { ...result };
  }

  /**
   * Drop expired entries, then the oldest, until there is room for one more.
   *
   * THE EXPIRY SWEEP IS WHAT MAKES THE EVICTION ORDER CORRECT, not just a
   * tidy-up. `Map` iterates in insertion order, but `Map.set` on a key that is
   * ALREADY PRESENT does not move it to the end — so insertion order equals
   * write order only because every re-write of a key is preceded by a delete,
   * from this sweep or from `invalidate`. Remove the sweep and a stale entry
   * refreshed in place keeps its original position, and the memo evicts its
   * NEWEST verdict as though it were the oldest.
   */
  #evict() {
    const nowMs = this.#nowMs();
    for (const [key, entry] of this.#memo) {
      if (nowMs - entry.at >= GetPianoLessonGate.MEMO_TTL_MS) this.#memo.delete(key);
    }
    while (this.#memo.size >= GetPianoLessonGate.MEMO_MAX_ENTRIES) {
      this.#memo.delete(this.#memo.keys().next().value);
    }
  }

  /**
   * Accept either clock shape, byte-identical to
   * `PianoLessonCeremonyBridge#nowMs`. This is convention-matching, NOT a
   * correctness fix: `Date.prototype.valueOf` means a raw `Date` would
   * subtract and compare correctly on its own. The composition injects
   * `() => new Date()`; a caller passing `() => Date.now()` is equally fine.
   */
  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }

  /**
   * The kiosk-facing slice of a `nextLesson` context. Optional fields are
   * omitted rather than emptied so the card can branch on presence.
   */
  #target({ course, unit, lesson }) {
    return {
      course,
      unit: unit ?? null,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        ...(lesson.position != null ? { position: lesson.position } : {}),
        ...(lesson.thumbnail ? { thumbnail: lesson.thumbnail } : {}),
        ...(lesson.description ? { description: lesson.description } : {}),
      },
    };
  }
}

export default GetPianoLessonGate;
