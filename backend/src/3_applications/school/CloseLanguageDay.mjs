import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { programUnitId } from './assignedProgramPlan.mjs';

const canonicalProgramId = (programId) => (
  programId === 'language' ? 'sentence-ladder' : programId
);

/** Settles a completed language study day into the School session ledger. */
export class CloseLanguageDay {
  #assignments; #curriculum; #sessions; #close; #clock; #logger; #locks = new Map();
  #unsubscribe = null;

  constructor({ assignments, curriculum, sessions, closeSessionOutcome, realtime = null,
    clock = () => new Date(), logger = console } = {}) {
    if (!assignments || !curriculum || !sessions || !closeSessionOutcome) {
      throw new Error('CloseLanguageDay requires assignments, curriculum, sessions and closeSessionOutcome');
    }
    this.#assignments = assignments;
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#close = closeSessionOutcome;
    this.#clock = clock;
    this.#logger = logger;
    if (realtime?.onLanguageDayCompleted) this.#unsubscribe = realtime.onLanguageDayCompleted((payload) => (
      this.handle(payload).catch((error) => this.#logger.warn?.('school.language.close-failed', {
        error: error?.message ?? String(error),
      }))
    ));
  }

  stop() { this.#unsubscribe?.(); this.#unsubscribe = null; }

  async handle({ learnerId, corpusId, day, programId = 'language' } = {}) {
    if (!learnerId || !corpusId || !Number.isInteger(day) || day < 1) return { status: 'ignored' };
    const sessionId = `ses_lang_${learnerId}_${corpusId}_d${day}`;
    const prior = this.#locks.get(sessionId) ?? Promise.resolve();
    const run = prior.then(() => this.#settle({ learnerId, corpusId, day, programId, sessionId }));
    const guarded = run.catch(() => {});
    this.#locks.set(sessionId, guarded);
    try { return await run; } finally {
      if (this.#locks.get(sessionId) === guarded) this.#locks.delete(sessionId);
    }
  }

  /**
   * ONE lookup answers "is this program assigned", and it reads `programs:` —
   * the collection a learner plan actually stores an enrollment in.
   *
   * This method used to ask the question twice, against two different
   * collections twenty lines apart: the gate below matched `standaloneWork`
   * (via the store's `units` alias) against the authored curriculum catalog,
   * while the reward it later resolved came from `programs`. No household plan
   * has ever carried a ladder under `standaloneWork`, and no program-kind unit
   * has ever been authored, so the gate always took the `unassigned` branch
   * and a completed language day has never opened a work session — while the
   * reward lookup sat right there, reading the enrollment correctly.
   */
  async #settle({ learnerId, corpusId, day, programId, sessionId }) {
    const canonicalId = canonicalProgramId(programId);
    const assignment = await this.#assignments.get(learnerId);
    const policy = (assignment?.programs ?? []).find((entry) => (
      canonicalProgramId(entry?.programId) === canonicalId && entry?.corpusId === corpusId
    ));
    if (!policy) {
      this.#logger.info?.('school.language.close-unassigned', { learnerId, corpusId, day, programId });
      return { status: 'unassigned', sessionId };
    }
    const existing = reduceSession(await this.#sessions.readEvents(sessionId));
    // SETTLED ONCE. A day that already has its outcome is not closed again:
    // the close-out path treats a second close as a retry and re-prints the
    // receipt, so every repeat of this fact put another "PASSED" slip on the
    // roll for work finished the day before (2026-09-12: one open of a finished
    // ladder day printed it six times). Reprinting is a grown-up's explicit act.
    if (existing.outcome) {
      this.#logger.info?.('school.language.close-already-settled', { learnerId, corpusId, day, sessionId });
      return { status: 'already_settled', sessionId };
    }
    if (!existing.sessionId) {
      const at = this.#clock().toISOString();
      for (const raw of [
        { type: 'created', at, sessionId, learnerId, unitId: await this.#unitIdFor(canonicalId, corpusId) },
        { type: 'program_dispatched', at, sessionId, programId, corpusId, day },
      ]) {
        const { errors, event } = createEvent(raw);
        if (errors.length) throw new Error(`language session event invalid: ${errors.join('; ')}`);
        await this.#sessions.appendEvent(sessionId, event);
      }
    }
    return this.#close.execute({
      sessionId, honorClose: true,
      rewardOverride: policy?.reward ?? null,
    });
  }

  /**
   * An authored curriculum unit still wins where a household wrote one, so
   * existing sessions keep their identity. Otherwise the session takes the
   * same synthetic id the plan entry carries — the enrollment IS the
   * assignment, and the catalog has nothing to say about it.
   */
  async #unitIdFor(canonicalId, corpusId) {
    const units = await this.#curriculum.listUnits();
    const authored = units.find((candidate) => canonicalProgramId(candidate.program) === canonicalId
      && (candidate.programInstance ?? corpusId) === corpusId);
    return authored?.unitId ?? programUnitId(canonicalId, corpusId);
  }
}

export default CloseLanguageDay;
