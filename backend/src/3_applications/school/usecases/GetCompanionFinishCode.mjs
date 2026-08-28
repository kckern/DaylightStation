/**
 * The escape hatch, and it is deliberately only half of one.
 *
 * When the read-along will not play — a dead file, Plex down, a renderer bug —
 * a child is holding a worksheet whose gate row they cannot fill in, and no
 * amount of scoring saves it. A grown-up must be able to read them the letters.
 *
 * SO A TEACHER CAN REVEAL THE CODE. A TEACHER CANNOT SATISFY THE COMPANION.
 *
 * Nothing here touches `satisfiedAt` / `satisfiedBy` / `satisfiedVia`. The
 * alternative — letting a grown-up mark it done — was considered and rejected:
 * it would unblock every sibling in one move and need only one mechanism, but
 * it would spend the distinction between a child who LISTENED and a child who
 * was TOLD, and that distinction is the only thing making the coverage record
 * worth keeping. §8 of the design already lets siblings tell each other the
 * code; what it does not allow is the record claiming someone listened.
 *
 * What it does instead is WRITE THE REVEAL DOWN, on the same record, beside the
 * `satisfiedAt: null` it leaves alone. A sheet that later passes its gate
 * against an unsatisfied companion is then explicable — "a grown-up read it out
 * at 15:30" — rather than a mystery a report has to guess at.
 *
 * THE CODE IS A SECRET FROM CHILDREN, NOT FROM GROWN-UPS. The letters leave
 * this method only through its return value, which is served by ONE
 * teacher-gated route and reaches no child-facing surface — the same discipline
 * `IssueDocument.execute()` keeps by never putting `finishCode` on the value
 * that travels to `ResolveScanAction`. The gate is asserted BEFORE any read, so
 * a refused caller cannot even learn whether a code exists; and the log line
 * that records the reveal carries the sessionId and the actor, never the
 * letters, because logs ship to a store with a much wider audience than this
 * route.
 *
 * READ-ONLY IN THE SENSE THAT MATTERS: it changes nothing a gate, a grade or a
 * report reads. The one write it makes is the audit trail of itself.
 */
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { formatCode } from '#domains/school/companionCode.mjs';
// The scope helper `IssueDocument` mints codes with. IMPORTED, never re-derived:
// a second copy of `module ?? courseId ?? unitId` that drifted by one fallback
// would look up a DIFFERENT record from the one printed on the child's sheet
// and read out letters that cannot clear their gate.
import { companionLessonDay } from './IssueDocument.mjs';

/** How many reveals one code record keeps. Newest last; older ones fall off. */
const MAX_REVEALS = 50;

export class GetCompanionFinishCode {
  #sessions; #curriculum; #companionCodes; #teacherGate; #householdId; #clock; #logger;

  /**
   * @param {object} deps
   * @param {object} deps.sessions - session event source
   * @param {object} deps.curriculum - to resolve the unit, which carries `companion`
   * @param {object} deps.companionCodes - `YamlCompanionCodeStore`-shaped, INJECTED by
   *   the composition root; an application module may not reach for an adapter (D1)
   * @param {object} deps.teacherGate - the console's one authorization predicate
   * @param {string} deps.householdId - the first third of a code's scope
   */
  constructor({ sessions, curriculum, companionCodes, teacherGate, householdId = null, clock = () => new Date(), logger = console } = {}) {
    if (!sessions) throw new Error('GetCompanionFinishCode requires sessions');
    if (!curriculum) throw new Error('GetCompanionFinishCode requires curriculum');
    if (!companionCodes) throw new Error('GetCompanionFinishCode requires companionCodes');
    if (!teacherGate) throw new Error('GetCompanionFinishCode requires teacherGate');
    this.#sessions = sessions;
    this.#curriculum = curriculum;
    this.#companionCodes = companionCodes;
    this.#teacherGate = teacherGate;
    this.#householdId = householdId;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId - the session whose sheet is stuck
   * @param {string|null} [args.revealedBy] - the acting teacher's stamp
   * @param {string|object|null} [args.pin] - console PIN, or the capability proof
   * @returns {Promise<{schema: string, sessionId: string, lessonId: string|null,
   *   gated: boolean, available: boolean, reason: string|null, finishCode: string|null,
   *   earned: boolean, satisfiedAt: string|null, satisfiedVia: string|null,
   *   codeRef: string|null, revealedAt: string|null}>}
   */
  async execute({ sessionId, revealedBy = null, pin = null } = {}) {
    // FIRST, before a single read. A refusal must not be able to tell a caller
    // whether the lesson has a companion, let alone whether a code exists.
    this.#teacherGate.assert({
      userId: revealedBy, pin, action: 'companion.finish-code.reveal', context: { sessionId },
    });
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new ValidationError('sessionId is required');

    const events = await this.#sessions.readEvents(sessionId);
    if (!events?.length) throw new EntityNotFoundError('session', sessionId);
    const state = reduceSession(events);
    const lessonId = state.unitId ?? null;
    const unit = lessonId ? await this.#curriculum.getUnit(lessonId) : null;

    const answer = (fields) => ({
      schema: 'school.companion-finish-code/v1',
      sessionId, lessonId,
      gated: false, available: false, reason: null,
      finishCode: null, earned: false,
      satisfiedAt: null, satisfiedVia: null,
      codeRef: null, revealedAt: null,
      ...fields,
    });

    // The same two questions `IssueDocument#prepareCompanion` asks, in the same
    // order: `enabled: false` is the author saying there is no companion here
    // at all, and anything short of `required` gates nothing — so neither owes
    // a grown-up a code, and neither is an error.
    const configured = unit?.companion ?? {};
    if (configured.enabled === false) return answer({ reason: 'no-companion' });
    if (configured.participation !== 'required') {
      return answer({ reason: unit?.companion ? 'companion-optional' : 'no-companion' });
    }

    // The scope is (household, lesson, lessonDay) — no learner, which is what
    // makes one code serve every child on the lesson. A blank part makes
    // `keyFor` THROW, which would escape as a 500 instead of the slip this
    // method owes a grown-up, so the parts are checked before it is called.
    const lessonDay = companionLessonDay(unit, lessonId);
    const usable = (value) => typeof value === 'string' && value.trim() !== '';
    if (!usable(this.#householdId) || !usable(lessonId) || !usable(lessonDay)) {
      this.#logger.warn?.('school.companion-code.reveal-unscoped', { sessionId, lessonId, lessonDay });
      return answer({ gated: true, reason: 'not-issued' });
    }

    const codeRef = this.#companionCodes.keyFor({ householdId: this.#householdId, lessonId, lessonDay });
    const record = await this.#companionCodes.get(codeRef);
    // No record means the worksheet has not printed yet — there is nothing to
    // read out, and minting one here would put a code into the world that no
    // sheet names.
    if (!record) return answer({ gated: true, reason: 'not-issued', codeRef });

    const finishCode = formatCode(record.code);
    if (!finishCode) {
      // `formatCode` answers null, never `''`, for input it cannot read. Saying
      // "the code is (blank)" to a grown-up who would then read a blank row out
      // to a child is the one failure mode worse than saying nothing.
      this.#logger.warn?.('school.companion-code.reveal-unusable', { sessionId, lessonId, codeRef });
      return answer({ gated: true, reason: 'code-unusable', codeRef });
    }

    const at = this.#clock().toISOString();
    // The audit trail, written onto the record that holds the satisfaction it
    // does NOT touch — so the two facts are read together or not at all.
    // `update`'s mutator edits its draft in place and returns undefined, which
    // is the store's one accepted non-record return.
    await this.#companionCodes.update(codeRef, (draft) => {
      const reveals = Array.isArray(draft.reveals) ? draft.reveals : [];
      draft.reveals = [...reveals, { at, by: revealedBy, sessionId }].slice(-MAX_REVEALS);
    });

    // No letters in the log line: log events ship to a store read by far more
    // eyes than this route serves.
    this.#logger.info?.('school.companion-code.revealed', {
      sessionId, lessonId, codeRef, revealedBy, earned: Boolean(record.satisfiedAt),
    });

    return answer({
      gated: true,
      available: true,
      finishCode,
      // Satisfaction is reported, never granted. `earned: false` beside a code
      // in a grown-up's hand is the whole point: it says out loud that nobody
      // has listened to this yet.
      earned: Boolean(record.satisfiedAt),
      satisfiedAt: record.satisfiedAt ?? null,
      satisfiedVia: record.satisfiedVia ?? null,
      codeRef,
      revealedAt: at,
    });
  }
}

export default GetCompanionFinishCode;
