import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';

const canonicalProgramId = (programId) => (
  programId === 'language' ? 'sentence-ladder' : programId
);

/** Settles a completed language study day into the School session ledger. */
export class CloseLanguageDay {
  #assignments; #curriculum; #sessions; #close; #clock; #logger; #locks = new Map();
  #unsubscribe = null;

  constructor({ assignments, curriculum, sessions, closeSessionOutcome, eventBus = null,
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
    if (eventBus?.subscribe) this.#unsubscribe = eventBus.subscribe('school.language.day-complete', (payload) => (
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

  async #settle({ learnerId, corpusId, day, programId, sessionId }) {
    const canonicalId = canonicalProgramId(programId);
    const assignment = await this.#assignments.get(learnerId);
    const assigned = (assignment?.units ?? []).map((entry) => typeof entry === 'string' ? { unitId: entry } : entry);
    const units = await this.#curriculum.listUnits();
    const unit = units.find((candidate) => assigned.some((entry) => entry.unitId === candidate.unitId)
      && canonicalProgramId(candidate.program) === canonicalId
      && (candidate.programInstance ?? corpusId) === corpusId);
    if (!unit) {
      this.#logger.info?.('school.language.close-unassigned', { learnerId, corpusId, day, programId });
      return { status: 'unassigned', sessionId };
    }
    const existing = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!existing.sessionId) {
      const at = this.#clock().toISOString();
      for (const raw of [
        { type: 'created', at, sessionId, learnerId, unitId: unit.unitId },
        { type: 'program_dispatched', at, sessionId, programId, corpusId, day },
      ]) {
        const { errors, event } = createEvent(raw);
        if (errors.length) throw new Error(`language session event invalid: ${errors.join('; ')}`);
        await this.#sessions.appendEvent(sessionId, event);
      }
    }
    const policy = (assignment?.programs ?? []).find((entry) => (
      canonicalProgramId(entry?.programId) === canonicalId && entry?.corpusId === corpusId
    ));
    return this.#close.execute({
      sessionId, honorClose: true,
      rewardOverride: policy?.reward ?? null,
    });
  }
}

export default CloseLanguageDay;
