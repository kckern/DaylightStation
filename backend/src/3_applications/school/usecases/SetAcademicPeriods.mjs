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

  async execute({ periods, editedBy = null, pin = null } = {}) {
    this.#teacherGate.assert({
      userId: editedBy, pin, action: 'periods.edit',
      context: { count: Array.isArray(periods) ? periods.length : 0 },
    });
    const validated = await this.#store.replacePeriods(periods, {
      editedBy, at: this.#clock().toISOString(),
    });
    return { periods: validated };
  }
}
