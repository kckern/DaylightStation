/**
 * SetMilestones — the gated whole-list milestones write (plan W3-3): every
 * entry validated before anything is written.
 */
import { validateMilestone } from '#domains/school/milestones.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

export class SetMilestones {
  #store; #teacherGate; #clock;

  constructor({ store, teacherGate, clock = () => new Date() } = {}) {
    if (!store) throw new Error('SetMilestones requires store');
    if (!teacherGate) throw new Error('SetMilestones requires teacherGate');
    this.#store = store;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
  }

  async execute({ milestones, editedBy = null, pin = null } = {}) {
    this.#teacherGate.assert({
      userId: editedBy, pin, action: 'milestones.edit',
      context: { count: Array.isArray(milestones) ? milestones.length : 0 },
    });
    if (!Array.isArray(milestones)) throw new ValidationError('milestones must be an array');
    const validated = milestones.map((raw, i) => {
      const { errors, milestone } = validateMilestone(raw);
      if (errors.length) throw new ValidationError(`milestones[${i}]: ${errors.join('; ')}`);
      return milestone;
    });
    const ids = new Set(validated.map((m) => m.id));
    if (ids.size !== validated.length) throw new ValidationError('milestone ids must be unique');
    await this.#store.replace(validated, { editedBy, at: this.#clock().toISOString() });
    return { milestones: validated };
  }
}
