/**
 * SetPassOverride — the gated mid-period pass-criteria write (plan W3-2).
 * `percent` is an integer 1–100 or null (clear). The authored curriculum
 * stays untouched; the override is data with an audit trail.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { announceRecordChanged } from "./announceRecordChanged.mjs";

export class SetPassOverride {
  #store; #teacherGate; #clock; #logger; #realtime;

  constructor({ store, teacherGate, clock = () => new Date(), logger = console, realtime = null } = {}) {
    if (!store) throw new Error('SetPassOverride requires store');
    if (!teacherGate) throw new Error('SetPassOverride requires teacherGate');
    this.#store = store;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
    this.#realtime = realtime;
  }

  async execute({ unitId, percent = null, editedBy = null } = {}) {
    this.#teacherGate.assert({ userId: editedBy, action: 'passcriteria.edit', context: { unitId, percent } });
    if (typeof unitId !== 'string' || !unitId.trim()) throw new ValidationError('unitId is required');
    if (percent !== null && (!Number.isInteger(percent) || percent < 1 || percent > 100)) {
      throw new ValidationError('percent must be an integer from 1-100, or null to clear');
    }
    await this.#store.set(unitId, percent, { editedBy, at: this.#clock().toISOString() });
    this.#logger.info?.('school.pass-override.set', {
      unitId, percent, editedBy, cleared: percent === null,
    });
    announceRecordChanged(this.#realtime, this.#logger, { learnerIds: [], kind: 'pass-override' });
    return { unitId, percent };
  }
}
