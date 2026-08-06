/**
 * SetAcademicPeriods — the gated periods write (plan W3-1). Gate first, then
 * validate-and-replace with history; a refusal or a bad period writes nothing.
 */
export class SetAcademicPeriods {
  #store; #teacherGate; #frozenPeriodIds; #clock;

  /**
   * @param {(() => Promise<Iterable<string>>)|null} [deps.frozenPeriodIds] -
   *   optional thunk answering periodIds that have FROZEN report cards.
   *   Removing (or renaming, which reads as remove+add) such an id strands
   *   every frozen card keyed to it (admin advocacy #15) — refused BY NAME.
   */
  constructor({ store, teacherGate, frozenPeriodIds = null, clock = () => new Date() } = {}) {
    if (!store) throw new Error('SetAcademicPeriods requires store');
    if (!teacherGate) throw new Error('SetAcademicPeriods requires teacherGate');
    this.#store = store;
    this.#teacherGate = teacherGate;
    this.#frozenPeriodIds = typeof frozenPeriodIds === 'function' ? frozenPeriodIds : null;
    this.#clock = clock;
  }

  async execute({ periods, editedBy = null, pin = null, baseHistoryLength = undefined } = {}) {
    this.#teacherGate.assert({
      userId: editedBy, pin, action: 'periods.edit',
      context: { count: Array.isArray(periods) ? periods.length : 0 },
    });
    // Concurrent-edit guard (advocacy B14), optional like assignments'.
    if (baseHistoryLength !== undefined && typeof this.#store.historyLength === 'function'
        && this.#store.historyLength() !== baseHistoryLength) {
      const err = new Error('The periods changed since you loaded them — reload and try again.');
      err.name = 'ValidationError';
      throw err;
    }
    if (this.#frozenPeriodIds && Array.isArray(periods)) {
      const nextIds = new Set(periods.map((p) => p?.periodId).filter(Boolean));
      const frozen = [...new Set(await this.#frozenPeriodIds())];
      const stranded = frozen.filter((id) => !nextIds.has(id));
      if (stranded.length) {
        const err = new Error(`refusing: frozen report cards exist for ${stranded.join(', ')} — removing or renaming these periodIds would strand them`);
        err.name = 'ValidationError';
        throw err;
      }
    }
    const validated = await this.#store.replacePeriods(periods, {
      editedBy, at: this.#clock().toISOString(),
    });
    return { periods: validated };
  }
}
