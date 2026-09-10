/**
 * GetLearnerTerm — the status board's term grid, as data.
 *
 * `{ termId, label, from, to, today, version, days[], weeks[] }`. `days` runs
 * from the term's first day to today; `to` lets the board draw the empty
 * tail. Each day is a colour and a reason; each week is the 8th row.
 *
 * A thin door over `TermVerdictService.read` so the router, the completion
 * bridge and the CLI share one reading of "the term".
 */
export class GetLearnerTerm {
  #service;
  constructor({ termVerdicts } = {}) {
    if (!termVerdicts) throw new Error('GetLearnerTerm requires termVerdicts');
    this.#service = termVerdicts;
  }

  /**
   * @param {{learnerId: string, termId?: string|null}} args
   */
  async execute({ learnerId, termId = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new Error('GetLearnerTerm requires learnerId');
    const { term, today, version, days, weeks, pending } = await this.#service.read(learnerId, { termId });
    return {
      learnerId,
      termId: term?.termId ?? null, label: term?.label ?? null,
      from: term?.from ?? null, to: term?.to ?? null,
      today, version, days, weeks, pending,
    };
  }
}

export default GetLearnerTerm;
