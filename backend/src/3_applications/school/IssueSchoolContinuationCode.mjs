import {
  encodeSchoolContinuationCode,
  normalizeSchoolContinuationModuleCode,
} from '#domains/school/continuationCode.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/** Issue a portable, offline continuation route for one known learner. */
export class IssueSchoolContinuationCode {
  #learners; #slots;

  constructor({ learners, learnerSlots } = {}) {
    if (!learners || typeof learners.hasLearner !== 'function') {
      throw new Error('IssueSchoolContinuationCode requires a learner directory');
    }
    this.#learners = learners;
    this.#slots = normalizeSlots(learnerSlots);
  }

  async execute({ learnerId, moduleCode } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (!(await this.#learners.hasLearner(learnerId))) throw new ValidationError(`unknown learner: ${learnerId}`);
    const learnerSlot = this.#slots.get(learnerId);
    if (learnerSlot === undefined) throw new ValidationError(`learner has no School continuation slot: ${learnerId}`);
    const normalizedModuleCode = normalizeSchoolContinuationModuleCode(moduleCode);
    return Object.freeze({
      schema: 'school.continuation-code/v1',
      learnerId,
      learnerSlot,
      moduleCode: normalizedModuleCode,
      code: encodeSchoolContinuationCode({ learnerSlot, moduleCode: normalizedModuleCode }),
    });
  }
}

function normalizeSlots(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('School continuation learnerSlots must be a learnerId-to-slot mapping');
  }
  const entries = Object.entries(value);
  if (entries.length !== 4 || entries.some(([id, slot]) => !id || !Number.isInteger(slot) || slot < 0 || slot > 3)
      || new Set(entries.map(([, slot]) => slot)).size !== 4) {
    throw new Error('School continuation learnerSlots must assign slots 0..3 exactly once');
  }
  return new Map(entries);
}

export default IssueSchoolContinuationCode;
