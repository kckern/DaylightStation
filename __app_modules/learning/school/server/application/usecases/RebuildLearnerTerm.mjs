/**
 * RebuildLearnerTerm — backfill (or force-recompute) a learner's term
 * verdicts. Teacher-gated where it is reachable from the API; the CLI runs it
 * directly. Oldest day first, written every ten days, so an interrupted run
 * keeps its progress.
 */
export class RebuildLearnerTerm {
  #service; #teacherGate; #clock; #logger;
  constructor({ termVerdicts, teacherGate = null, clock = () => new Date(), logger = console } = {}) {
    if (!termVerdicts) throw new Error('RebuildLearnerTerm requires termVerdicts');
    this.#service = termVerdicts;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string, termId?: string|null, from?: string|null, to?: string|null,
   *          force?: boolean, userId?: string, pin?: string, onProgress?: Function}} args
   */
  async execute({ learnerId, termId = null, from = null, to = null, force = false, userId, pin, onProgress = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new Error('RebuildLearnerTerm requires learnerId');
    this.#teacherGate?.assert?.({ userId, pin, action: 'term.rebuild', context: { learnerId, termId, force } });
    const startedAt = this.#clock().getTime();
    const result = await this.#service.rebuild(learnerId, { termId, from, to, force, onProgress });
    this.#logger.info?.('school.term-verdicts.rebuilt', {
      learnerId, ...result, days: undefined, elapsedMs: this.#clock().getTime() - startedAt,
    });
    return result;
  }
}

export default RebuildLearnerTerm;
