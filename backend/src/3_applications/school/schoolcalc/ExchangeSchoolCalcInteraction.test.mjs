import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { ExchangeSchoolCalcInteraction } from './ExchangeSchoolCalcInteraction.mjs';

function device() {
  return SchoolCalcDevice.enroll({
    deviceId: 'DEV001', label: 'Calculator', platformId: 'future', catalogId: 'main', createdAt: 'created',
  }).synchronizeLearners({
    synchronizedAt: '2026-08-02T00:00:00.000Z', learners: [{ id: 'kid-a', name: 'Alpha' }],
  }).device;
}

const session = {
  sessionId: 'REM_A', learnerId: 'kid-a', status: 'active', masteryPercent: 0,
  targetPercent: 80, currentTurnId: 'TURN_1', nextClientSequence: 1, nextServerSequence: 2,
  cursor: { nextClientSequence: 1, latestServerSequence: 1 },
  turns: [{
    turnId: 'TURN_1', serverSequence: 1, body: 'Think in equal groups.', prompt: 'Choose.',
    choices: [{ id: 'A', label: 'One', functionKey: 'F1' }, { id: 'B', label: 'Two', functionKey: 'F2' }],
  }],
};

function harness(request) {
  const encodeInteractionResponse = vi.fn((value) => Buffer.from(JSON.stringify(value)));
  const followUps = { execute: vi.fn(async () => ({
    status: 'ready', launch: { type: 'adaptive_remediation', sessionId: 'REM_A' },
  })) };
  const tutor = {
    get: vi.fn(async () => structuredClone(session)),
    act: vi.fn(async () => ({ status: 'complete', retryable: false, session: structuredClone(session) })),
  };
  return {
    followUps, tutor, encodeInteractionResponse,
    useCase: new ExchangeSchoolCalcInteraction({
      devices: { getDevice: async () => device() },
      codecs: { get: () => ({ decodeInteractionRequest: () => request, encodeInteractionResponse }) },
      followUps, remediationTutor: tutor,
    }),
  };
}

describe('ExchangeSchoolCalcInteraction', () => {
  it('resolves and starts a follow-up using the request sequence as the idempotency boundary', async () => {
    const request = {
      schema: 'school.calc.interaction-request/v1', deviceId: 'DEV001', learnerKey: 1,
      requestId: 7, action: 'invoke_follow_up', actionKey: 'ABC234DEFG',
      clientSequence: 0, lastServerSequence: 0,
    };
    const fixture = harness(request);
    fixture.tutor.get.mockResolvedValueOnce({
      ...session, status: 'offered', currentTurnId: null, turns: [],
      nextClientSequence: 0, nextServerSequence: 1,
      cursor: { nextClientSequence: 0, latestServerSequence: 0 },
    });
    const result = await fixture.useCase.execute({ deviceId: 'DEV001', record: Buffer.from('request') });
    expect(fixture.followUps.execute).toHaveBeenCalledWith({
      deviceId: 'DEV001', learnerKey: 1, actionKey: 'ABC234DEFG',
    });
    expect(fixture.tutor.act).toHaveBeenCalledWith({
      sessionId: 'REM_A', access: { surface: 'schoolcalc', endpointId: 'DEV001' }, clientSequence: 0,
      lastServerSequence: 0, action: 'start', turnId: null, choiceId: null,
    });
    expect(result.response).toMatchObject({
      requestId: 7, status: 'complete', acknowledgeRequest: true, retryable: false,
      session: { sessionId: 'REM_A' },
    });
  });

  it('maps a choice directly to the durable session and retains processing requests', async () => {
    const request = {
      schema: 'school.calc.interaction-request/v1', deviceId: 'DEV001', learnerKey: 1,
      requestId: 8, action: 'choice', sessionId: 'REM_A', clientSequence: 1,
      lastServerSequence: 1, turnId: 'TURN_1', choiceId: 'B',
    };
    const fixture = harness(request);
    fixture.tutor.act.mockResolvedValueOnce({ status: 'processing', retryable: true, session });
    const result = await fixture.useCase.execute({ deviceId: 'DEV001', record: Buffer.from('request') });
    expect(fixture.followUps.execute).not.toHaveBeenCalled();
    expect(fixture.tutor.act).toHaveBeenCalledWith(expect.objectContaining({
      action: 'choice', turnId: 'TURN_1', choiceId: 'B', clientSequence: 1,
    }));
    expect(result.response).toMatchObject({
      status: 'processing', acknowledgeRequest: false, retryable: true,
    });
  });

  it('maps a learner control to the current turn without inventing an answer', async () => {
    const request = {
      schema: 'school.calc.interaction-request/v1', deviceId: 'DEV001', learnerKey: 1,
      requestId: 9, action: 'explain', sessionId: 'REM_A', clientSequence: 1,
      lastServerSequence: 1, turnId: 'TURN_1',
    };
    const fixture = harness(request);
    fixture.tutor.act.mockResolvedValueOnce({
      status: 'complete', retryable: false, session,
      control: { control: 'explain', turnId: 'TURN_1', conceptId: 'fractions' },
    });
    const result = await fixture.useCase.execute({ deviceId: 'DEV001', record: Buffer.from('request') });
    expect(fixture.tutor.act).toHaveBeenCalledWith(expect.objectContaining({
      action: 'explain', turnId: 'TURN_1', choiceId: null, clientSequence: 1,
    }));
    expect(result.response).toMatchObject({
      status: 'complete', message: 'Here is another explanation.',
    });
    expect(result.response).not.toHaveProperty('answer');
  });

  it('resumes an active projected follow-up without starting or calling AI again', async () => {
    const request = {
      schema: 'school.calc.interaction-request/v1', deviceId: 'DEV001', learnerKey: 1,
      requestId: 10, action: 'invoke_follow_up', actionKey: 'ABC234DEFG',
      clientSequence: 0, lastServerSequence: 0,
    };
    const fixture = harness(request);
    const result = await fixture.useCase.execute({ deviceId: 'DEV001', record: Buffer.from('request') });
    expect(fixture.tutor.act).not.toHaveBeenCalled();
    expect(result.response).toMatchObject({
      status: 'complete', session: { status: 'active', currentTurnId: 'TURN_1' },
    });
  });

  it('returns a retryable record when AI is unavailable and fails closed across learners', async () => {
    const request = {
      schema: 'school.calc.interaction-request/v1', deviceId: 'DEV001', learnerKey: 1,
      requestId: 9, action: 'cancel', sessionId: 'REM_A',
      clientSequence: 1, lastServerSequence: 1,
    };
    const fixture = harness(request);
    fixture.tutor.act.mockRejectedValueOnce(Object.assign(new Error('offline'), {
      name: 'InfrastructureError', code: 'ADAPTIVE_TUTOR_UNAVAILABLE',
    }));
    await expect(fixture.useCase.execute({ deviceId: 'DEV001', record: Buffer.from('request') }))
      .resolves.toMatchObject({ response: {
        status: 'retryable_error', acknowledgeRequest: false, retryable: true,
      } });

    const crossed = harness(request);
    crossed.tutor.get.mockResolvedValueOnce({ ...session, learnerId: 'kid-b' });
    await expect(crossed.useCase.execute({ deviceId: 'DEV001', record: Buffer.from('request') }))
      .resolves.toMatchObject({ response: {
        status: 'unavailable', acknowledgeRequest: true,
      } });
    expect(crossed.tutor.act).not.toHaveBeenCalled();
  });
});
