import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Execute one durable calculator interaction request and return one exact
 * family record. A request remains on the calculator until the response says
 * `acknowledgeRequest`; tutor clientSequence provides effect idempotency when
 * a cable disappears after server work but before response promotion.
 */
export class ExchangeSchoolCalcInteraction {
  #devices; #codecs; #followUps; #tutor; #logger;

  constructor({ devices, codecs, followUps, remediationTutor, logger = null } = {}) {
    if (!devices || !codecs || !followUps || typeof followUps.execute !== 'function'
        || !remediationTutor || typeof remediationTutor.get !== 'function'
        || typeof remediationTutor.act !== 'function') {
      throw new Error('ExchangeSchoolCalcInteraction requires devices, codecs, followUps, and remediationTutor');
    }
    this.#devices = devices;
    this.#codecs = codecs;
    this.#followUps = followUps;
    this.#tutor = remediationTutor;
    this.#logger = logger;
  }

  async execute({ deviceId, record } = {}) {
    const device = await this.#devices.getDevice(deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    const codec = this.#codecs.get(device.platformId);
    const request = codec.decodeInteractionRequest(record);
    if (request.deviceId !== device.deviceId) {
      throw new ValidationError('SchoolCalc interaction belongs to another device', {
        code: 'SCHOOLCALC_DEVICE_ID_MISMATCH',
      });
    }
    const binding = device.resolveLearnerKey?.(request.learnerKey, { activeOnly: true }) ?? null;
    if (!binding) {
      return this.#respond(codec, request, unavailable('That learner is no longer active on this calculator.'));
    }

    try {
      const sessionId = request.action === 'invoke_follow_up'
        ? await this.#resolveInitialSession(request)
        : request.sessionId;
      if (!sessionId) {
        return this.#respond(codec, request, unavailable('That follow-up is no longer available.'));
      }
      const current = await this.#tutor.get({
        sessionId,
        access: { surface: 'schoolcalc', endpointId: device.deviceId },
        afterServerSequence: 0, maxTurns: 2,
      });
      if (current.learnerId !== binding.learnerId) {
        return this.#respond(codec, request, unavailable('That tutor session belongs to another learner.'));
      }
      // An offered follow-up starts with one durable effect. An already-active
      // follow-up is a resume/read, not another start action; this lets a fresh
      // calculator projection reopen an interrupted conversation without
      // guessing the server cursor or invoking the model again.
      const outcome = request.action === 'invoke_follow_up' && current.status === 'active'
        ? { status: 'complete', retryable: false, session: current }
        : await this.#tutor.act({
          sessionId,
          access: { surface: 'schoolcalc', endpointId: device.deviceId },
          clientSequence: request.clientSequence,
          lastServerSequence: request.lastServerSequence,
          action: request.action === 'invoke_follow_up' ? 'start' : request.action,
          turnId: request.turnId ?? null,
          choiceId: request.choiceId ?? null,
        });
      const response = outcome.status === 'processing'
        ? processing(outcome.session)
        : completed(outcome);
      this.#logger?.info?.('schoolcalc.interaction.exchanged', {
        deviceId: device.deviceId, learnerId: binding.learnerId,
        requestId: request.requestId, action: request.action,
        responseStatus: response.status,
      });
      return this.#respond(codec, request, response);
    } catch (error) {
      if (isRetryableInfrastructure(error)) {
        this.#logger?.warn?.('schoolcalc.interaction.retryable', {
          deviceId: device.deviceId, learnerId: binding.learnerId,
          requestId: request.requestId, error: error.message,
        });
        return this.#respond(codec, request, retryable('Tutor is temporarily unavailable. Keep this request and retry.'));
      }
      if (isRecoverableStateChange(error)) {
        return this.#respond(codec, request, unavailable('Tutor state changed. Sync My Progress and try again.'));
      }
      throw error;
    }
  }

  async #resolveInitialSession(request) {
    const resolved = await this.#followUps.execute({
      deviceId: request.deviceId,
      learnerKey: request.learnerKey,
      actionKey: request.actionKey,
    });
    return resolved.status === 'ready' && resolved.launch?.type === 'adaptive_remediation'
      ? resolved.launch.sessionId
      : null;
  }

  #respond(codec, request, partial) {
    const response = Object.freeze({
      schema: 'school.calc.interaction-response/v1',
      deviceId: request.deviceId,
      learnerKey: request.learnerKey,
      requestId: request.requestId,
      ...partial,
    });
    return Object.freeze({
      request: structuredClone(request),
      response,
      record: codec.encodeInteractionResponse(response),
    });
  }
}

function completed(outcome) {
  const session = outcome.session;
  let message = 'Tutor response ready.';
  if (outcome.answer) message = outcome.answer.correct ? 'Correct.' : 'Not yet. Review the explanation.';
  else if (outcome.control?.control === 'explain') message = 'Here is another explanation.';
  else if (outcome.control?.control === 'skip') message = 'Skipped without changing your score.';
  else if (outcome.control?.control === 'challenge') message = 'Here is a fresh challenge.';
  if (session.status === 'mastered') message = 'Mastery reached.';
  else if (session.status === 'improved') message = 'Progress improved.';
  else if (session.status === 'exhausted') message = 'Tutor session complete. Review is recommended.';
  else if (session.status === 'cancelled') message = 'Tutor session ended.';
  return {
    status: 'complete', acknowledgeRequest: true, retryable: false,
    message, session: structuredClone(session),
    ...(outcome.answer ? { answer: structuredClone(outcome.answer) } : {}),
  };
}

function processing(session) {
  return {
    status: 'processing', acknowledgeRequest: false, retryable: true,
    message: 'Tutor is still working. Retry this exact request safely.',
    ...(session ? { session: structuredClone(session) } : {}),
  };
}

function unavailable(message) {
  return { status: 'unavailable', acknowledgeRequest: true, retryable: false, message };
}

function retryable(message) {
  return { status: 'retryable_error', acknowledgeRequest: false, retryable: true, message };
}

function isRetryableInfrastructure(error) {
  return error?.name === 'InfrastructureError' || error?.code === 'ADAPTIVE_TUTOR_UNAVAILABLE';
}

function isRecoverableStateChange(error) {
  return error?.name === 'EntityNotFoundError'
    || ['REMEDIATION_ACTION_CONFLICT', 'REMEDIATION_ACTION_OUT_OF_ORDER'].includes(error?.code);
}

export default ExchangeSchoolCalcInteraction;
