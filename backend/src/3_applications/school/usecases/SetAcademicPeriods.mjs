/**
 * SetAcademicPeriods — the gated periods write (plan W3-1). Gate first, then
 * validate-and-replace with history; a refusal or a bad period writes nothing.
 */
export class SetAcademicPeriods {
  #store; #teacherGate; #clock;

  constructor({ store, teacherGate, clock = () => new Date() } = {}) {
    if (!store) throw new Error('SetAcademicPeriods requires store');
    if (!teacherGate) throw new Error('SetAcademicPeriods requires teacherGate');
    this.#store = store;
    this.#teacherGate = teacherGate;
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
    const validated = await this.#store.replacePeriods(periods, {
      editedBy, at: this.#clock().toISOString(),
    });
    return { periods: validated };
  }
}
