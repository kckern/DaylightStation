/**
 * SetMilestones — the gated milestones write (plan W3-3), LEARNER-SCOPED:
 * the panel edits one learner's targets, so the write replaces only that
 * learner's subset and preserves everyone else's — a whole-list replace from
 * a one-learner view would silently delete the siblings' milestones.
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

  async execute({ learnerId, milestones, editedBy = null, pin = null, baseHistoryLength = undefined } = {}) {
    this.#teacherGate.assert({
      userId: editedBy, pin, action: 'milestones.edit',
      context: { learnerId, count: Array.isArray(milestones) ? milestones.length : 0 },
    });
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    if (!Array.isArray(milestones)) throw new ValidationError('milestones must be an array');
    const validated = milestones.map((raw, i) => {
      const { errors, milestone } = validateMilestone({ ...raw, learnerId });
      if (errors.length) throw new ValidationError(`milestones[${i}]: ${errors.join('; ')}`);
      return milestone;
    });
    const ids = new Set(validated.map((m) => m.id));
    if (ids.size !== validated.length) throw new ValidationError('milestone ids must be unique');
    if (baseHistoryLength !== undefined && typeof this.#store.historyLength === 'function'
        && this.#store.historyLength() !== baseHistoryLength) {
      throw new ValidationError('Milestones changed since you loaded them — reload and try again.');
    }
    await this.#store.replaceForLearner(learnerId, validated, { editedBy, at: this.#clock().toISOString() });
    return { milestones: validated };
  }
}
