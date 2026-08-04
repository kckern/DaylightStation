import {
  DomainInvariantError,
  EntityNotFoundError,
  ValidationError,
} from '#domains/core/errors/index.mjs';

/**
 * Re-resolve a compact client follow-up key against current server state.
 *
 * SCG1 deliberately carries neither backend learner IDs nor target IDs. A
 * client key is therefore a locator, never authority: this use case checks the
 * device's current active learner binding, regenerates My Progress, and only
 * then returns a launch descriptor for the still-current action.
 */
export class ResolveSchoolCalcFollowUp {
  #devices; #progress; #codecs; #remediationTutor;

  constructor({ devices, progress, codecs, remediationTutor = null } = {}) {
    if (!devices || !progress || typeof progress.execute !== 'function' || !codecs) {
      throw new Error('ResolveSchoolCalcFollowUp requires devices, progress, and codecs');
    }
    this.#devices = devices;
    this.#progress = progress;
    this.#codecs = codecs;
    this.#remediationTutor = remediationTutor;
  }

  async execute({ deviceId, learnerKey, actionKey } = {}) {
    if (!Number.isSafeInteger(learnerKey) || learnerKey < 1 || learnerKey > 0xffff) {
      throw new ValidationError('SchoolCalc follow-up requires an active non-Guest learnerKey', {
        code: 'SCHOOLCALC_LEARNER_UNAVAILABLE',
      });
    }
    if (typeof actionKey !== 'string' || !actionKey || actionKey.length > 128) {
      throw new ValidationError('SchoolCalc follow-up actionKey is invalid', {
        code: 'INVALID_SCHOOLCALC_FOLLOW_UP_KEY',
      });
    }
    const device = await this.#devices.getDevice(deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    const binding = device.resolveLearnerKey?.(learnerKey, { activeOnly: true }) ?? null;
    if (!binding) {
      throw new ValidationError('SchoolCalc learner is Guest, retired, or unavailable on this device', {
        code: 'SCHOOLCALC_LEARNER_UNAVAILABLE',
      });
    }

    const projection = await this.#progress.execute({ deviceId: device.deviceId });
    const profile = projection.profiles?.find((candidate) => (
      candidate.learnerKey === learnerKey && candidate.learnerId === binding.learnerId
    ));
    if (!profile) return unavailable({ device, learnerKey, actionKey, reason: 'learner_projection_changed' });

    const codec = this.#codecs.get(device.platformId);
    const matches = (profile.followUps ?? []).filter((action) => (
      codec.projectFollowUpKey(action, learnerKey) === actionKey
    ));
    if (matches.length === 0) {
      return unavailable({ device, learnerKey, actionKey, reason: 'stale_or_withdrawn' });
    }
    if (matches.length > 1) {
      throw new DomainInvariantError('SchoolCalc follow-up key resolved to more than one current action', {
        code: 'SCHOOLCALC_FOLLOW_UP_KEY_COLLISION',
        details: { deviceId: device.deviceId, learnerKey, actionKey },
      });
    }
    const action = matches[0];
    if ((action.learnerId && action.learnerId !== binding.learnerId)
        || action.availability === 'blocked') {
      return unavailable({ device, learnerKey, actionKey, reason: 'not_available_to_learner' });
    }

    let launch;
    if (action.target.type === 'remediation_session') {
      if (!this.#remediationTutor) {
        return unavailable({ device, learnerKey, actionKey, reason: 'remediation_unavailable' });
      }
      const session = await this.#remediationTutor.get({
        sessionId: action.target.id,
        access: { surface: 'schoolcalc', endpointId: device.deviceId },
        afterServerSequence: 0,
        maxTurns: 2,
      });
      if (session.learnerId !== binding.learnerId
          || !['offered', 'active'].includes(session.status)) {
        return unavailable({ device, learnerKey, actionKey, reason: 'remediation_changed' });
      }
      launch = Object.freeze({
        type: 'adaptive_remediation',
        sessionId: session.sessionId,
        status: session.status,
        nextClientSequence: session.cursor?.nextClientSequence ?? session.nextClientSequence,
        latestServerSequence: session.cursor?.latestServerSequence ?? session.nextServerSequence - 1,
      });
    } else {
      launch = Object.freeze({ type: 'follow_up_target', target: structuredClone(action.target) });
    }

    return Object.freeze({
      status: 'ready',
      deviceId: device.deviceId,
      learnerKey,
      actionKey,
      action: structuredClone(action),
      launch,
    });
  }
}

function unavailable({ device, learnerKey, actionKey, reason }) {
  return Object.freeze({
    status: 'unavailable', deviceId: device.deviceId, learnerKey, actionKey, reason,
  });
}

export default ResolveSchoolCalcFollowUp;
