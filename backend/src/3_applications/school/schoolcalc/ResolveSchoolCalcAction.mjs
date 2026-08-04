import { validateLearningAction } from '#domains/school/catalog/index.mjs';

/** Resolve a registered learning-action token into a policy-checked effect. */
export class ResolveSchoolCalcAction {
  #devices; #content; #executor;

  constructor({ devices, content, executor } = {}) {
    if (!devices || !content || typeof content.getLearningAction !== 'function'
      || !executor || typeof executor.execute !== 'function') {
      throw new Error('ResolveSchoolCalcAction requires devices, content, and an action executor');
    }
    this.#devices = devices;
    this.#content = content;
    this.#executor = executor;
  }

  async execute({ record, scannerDevice = null } = {}) {
    const subject = record?.subject;
    if (record?.tokenClass !== 'learning_action' || !subject) {
      return unavailable('That is not a calculator lesson action.');
    }
    const device = await this.#devices.getDevice(subject.deviceId);
    if (!device) return unavailable('That calculator is no longer enrolled.');
    const raw = await this.#content.getLearningAction(subject.actionId);
    if (!raw) return unavailable('That lesson action is no longer published.');
    const validation = validateLearningAction(raw);
    if (validation.errors.length) return unavailable('That lesson action is not configured correctly.');
    const action = validation.action;
    if (!action.enabled) return unavailable('That lesson action is currently turned off.');
    if (action.actionId !== subject.actionId || action.tokenVersion !== subject.tokenVersion) {
      return unavailable('That lesson action has been replaced. Sync the calculator for a fresh code.', 'stale');
    }
    // Action codes are lesson-scoped and may outlive a user's selection. Never
    // infer attribution from the calculator. A future dynamic action envelope
    // may carry an explicit signed learner key; until then learner-specific
    // effects (such as printing) fail safely in the executor.
    const result = await this.#executor.execute({
      action,
      learnerId: null,
      deviceId: device.deviceId,
      lessonAddress: subject.address,
      scannerDevice,
    });
    if (!result || typeof result.status !== 'string' || typeof result.message !== 'string') {
      throw new Error('School learning-action executor returned an invalid result');
    }
    return Object.freeze({
      status: result.status,
      message: result.message,
      physical: result.physical === 'worksheet' ? 'worksheet' : 'none',
      printed: result.printed === true,
      effect: result.effect ? structuredClone(result.effect) : null,
    });
  }
}

function unavailable(message, status = 'unavailable') {
  return Object.freeze({ status, message, physical: 'none', printed: false, effect: null });
}

export default ResolveSchoolCalcAction;
