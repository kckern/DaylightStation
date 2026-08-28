/**
 * ManageProgramDayBypass — a grown-up excusing ONE learner's program
 * obligation for ONE study day.
 *
 * WHY A LEDGER AND NOT A FLAG. Same discipline as `ManageCurriculumException`
 * and `RecordAttestation`: an override that leaves no trace is unauditable, so
 * every grant carries a reason and an actor, retraction is another append
 * rather than a delete, and the whole history survives.
 *
 * WHY STUDY-DAY KEYED AND NOT TTL'd. The record stores an explicit
 * `studyDate`, computed here through the same 4am boundary the agenda and
 * `PianoCourseProgramLauncher` already use. It cannot leak into tomorrow:
 * tomorrow's `status()` computes a different key and this record simply stops
 * matching. A grant issued at 2am correctly files under the previous study
 * day, which is the day the child is still living in.
 *
 * WHERE IT IS CONSUMED. Not here — `PianoCourseProgramLauncher.status()` reads
 * the store directly, which is what makes the kiosk gate, the agenda card and
 * the completion ceremony agree without any of them knowing this use case
 * exists. A real completion always outranks a bypass (see that file's
 * ordering); this only ever settles a day nobody finished.
 *
 * @module applications/school/usecases/ManageProgramDayBypass
 */
import { createHash } from 'node:crypto';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

/** The household study day rolls at 4am, same as the rest of the agenda. */
const BOUNDARY_HOUR = 4;

/**
 * The topic the kiosk's gate hook listens on. Deliberately the same string as
 * `CEREMONY_TOPIC` in `PianoLessonCeremonyBridge.mjs` — one School topic, two
 * event names — declared locally rather than imported so this use case does
 * not depend on the ceremony bridge just to name a channel (the same call
 * `RecordStoryRead` makes for its own topic).
 */
const SCHOOL_TOPIC = 'school';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Deterministic id from the record's identity — the same learner/program/day
 * always yields the same id, which is what makes `grant` idempotent without a
 * second read after the store settles.
 */
const idFor = (seed) => `pdb_${createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)}`;

export class ManageProgramDayBypass {
  #store; #assignments; #teacherGate; #eventBus; #timezone; #clock; #logger;

  /**
   * @param {object} config
   * @param {{list: Function, append: Function, active: Function, activeFor: Function}} config.store
   * @param {{get: Function}} config.assignments - School's learner assignment store
   * @param {{assert: Function}} config.teacherGate - the console write predicate
   * @param {{broadcast?: Function}|null} [config.eventBus] - null degrades to no live push
   * @param {string|null} [config.timezone]
   * @param {() => Date} [config.clock]
   * @param {object} [config.logger]
   */
  constructor({
    store, assignments, teacherGate, eventBus = null,
    timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!store || !assignments || !teacherGate) {
      throw new Error('ManageProgramDayBypass requires store, assignments and teacherGate');
    }
    this.#store = store;
    this.#assignments = assignments;
    this.#teacherGate = teacherGate;
    this.#eventBus = eventBus;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** Active + full history, optionally narrowed to one learner. */
  async list({ learnerId = null } = {}) {
    const [active, history] = await Promise.all([this.#store.active(), this.#store.list()]);
    const mine = (rows) => (learnerId ? rows.filter((row) => row.learnerId === learnerId) : rows);
    return {
      schema: 'school.program-day-bypasses/v1',
      active: mine(active),
      history: mine(history),
    };
  }

  async grant({ learnerId, programId = 'piano-course', reason, decidedBy, pin = null } = {}) {
    this.#teacherGate.assert({
      userId: decidedBy, pin, action: 'program-day-bypass.grant', context: { learnerId, programId },
    });
    if (!text(learnerId)) throw new ValidationError('learnerId is required');
    if (!text(reason)) throw new ValidationError('a reason is required — an override without one is unauditable');

    // Excusing an obligation the learner does not have is a mistake worth
    // naming, not a no-op record to file.
    const assignment = await this.#assignments.get(learnerId);
    const enrolled = (assignment?.programs ?? []).some((row) => row?.programId === programId);
    if (!enrolled) throw new EntityNotFoundError('program enrollment', `${learnerId}:${programId}`);

    const studyDate = studyDayForInstant(this.#clock().getTime(), {
      timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
    });

    // Idempotent: two grown-ups excusing the same day is one excusal, not two
    // ledger rows that then need two retractions to undo.
    const existing = await this.#store.activeFor({ learnerId, programId, studyDate });
    if (existing) return existing;

    const record = {
      schema: 'school.program-day-bypass/v1',
      operation: 'applied',
      bypassId: idFor({ learnerId, programId, studyDate }),
      learnerId,
      programId,
      studyDate,
      reason: reason.trim(),
      decidedBy,
      decidedAt: this.#clock().toISOString(),
    };
    await this.#store.append(record);
    this.#logger.info?.('school.program-day-bypass.granted', { learnerId, programId, studyDate, decidedBy });
    this.#broadcast({ learnerId, programId, studyDate, active: true, decidedBy });
    return record;
  }

  async retract({ bypassId, reason, retractedBy, pin = null } = {}) {
    this.#teacherGate.assert({
      userId: retractedBy, pin, action: 'program-day-bypass.retract', context: { bypassId },
    });
    if (!text(bypassId) || !text(reason)) throw new ValidationError('bypassId and reason are required');

    const target = (await this.#store.active()).find((row) => row.bypassId === bypassId);
    if (!target) throw new EntityNotFoundError('active program day bypass', bypassId);

    const record = {
      schema: 'school.program-day-bypass/v1',
      operation: 'retracted',
      bypassId,
      reason: reason.trim(),
      retractedBy,
      retractedAt: this.#clock().toISOString(),
    };
    await this.#store.append(record);
    this.#logger.info?.('school.program-day-bypass.retracted', {
      learnerId: target.learnerId, bypassId, retractedBy,
    });
    this.#broadcast({
      learnerId: target.learnerId, programId: target.programId, studyDate: target.studyDate,
      active: false, decidedBy: retractedBy,
    });
    return record;
  }

  /**
   * Push the change to any kiosk showing this learner's gate. Best-effort by
   * design: a dead bus costs the instant clear (the kiosk's own poll still
   * catches up), never the write that already succeeded.
   */
  #broadcast(payload) {
    try {
      this.#eventBus?.broadcast?.(SCHOOL_TOPIC, {
        event: 'program-day-bypass-changed', ...payload, timestamp: this.#clock().getTime(),
      });
    } catch (err) {
      this.#logger.warn?.('school.program-day-bypass.broadcast-failed', {
        learnerId: payload.learnerId, error: err?.message ?? String(err),
      });
    }
  }
}

export default ManageProgramDayBypass;
