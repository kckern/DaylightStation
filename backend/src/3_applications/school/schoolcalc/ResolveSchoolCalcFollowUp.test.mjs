import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { ResolveSchoolCalcFollowUp } from './ResolveSchoolCalcFollowUp.mjs';

function device() {
  return SchoolCalcDevice.enroll({
    deviceId: 'DEV001', label: 'Shared calculator', platformId: 'future', catalogId: 'main', createdAt: 'created',
  }).synchronizeLearners({
    synchronizedAt: '2026-08-02T00:00:00.000Z',
    learners: [{ id: 'kid-a', name: 'Alpha' }, { id: 'kid-b', name: 'Beta' }],
  }).device;
}

const remediation = {
  actionId: 'remediation:REM_A', learnerId: 'kid-a', kind: 'remediation',
  label: 'Get tutor help', availability: 'requires_connection',
  target: { type: 'remediation_session', id: 'REM_A' }, priority: 10,
};

function harness({ followUps = [remediation], currentDevice = device() } = {}) {
  const projectFollowUpKey = vi.fn((action, learnerKey) => `${learnerKey}:${action.actionId}`);
  const progress = { execute: vi.fn(async () => ({
    deviceId: 'DEV001', profiles: [
      { learnerKey: 1, learnerId: 'kid-a', followUps },
      { learnerKey: 2, learnerId: 'kid-b', followUps: [] },
    ],
  })) };
  const remediationTutor = { get: vi.fn(async () => ({
    sessionId: 'REM_A', learnerId: 'kid-a', status: 'offered', nextServerSequence: 1,
    cursor: { nextClientSequence: 0, latestServerSequence: 0 },
  })) };
  return {
    projectFollowUpKey, progress, remediationTutor,
    useCase: new ResolveSchoolCalcFollowUp({
      devices: { getDevice: async () => currentDevice }, progress,
      codecs: { get: () => ({ projectFollowUpKey }) }, remediationTutor,
    }),
  };
}

describe('ResolveSchoolCalcFollowUp', () => {
  it('re-resolves an opaque key for the current active learner before launching remediation', async () => {
    const { useCase, progress, remediationTutor } = harness();
    await expect(useCase.execute({
      deviceId: 'DEV001', learnerKey: 1, actionKey: '1:remediation:REM_A',
    })).resolves.toMatchObject({
      status: 'ready', deviceId: 'DEV001', learnerKey: 1,
      action: { learnerId: 'kid-a', target: { id: 'REM_A' } },
      launch: {
        type: 'adaptive_remediation', sessionId: 'REM_A', status: 'offered',
        nextClientSequence: 0, latestServerSequence: 0,
      },
    });
    expect(progress.execute).toHaveBeenCalledWith({ deviceId: 'DEV001' });
    expect(remediationTutor.get).toHaveBeenCalledWith({
      sessionId: 'REM_A', access: { surface: 'schoolcalc', endpointId: 'DEV001' },
      afterServerSequence: 0, maxTurns: 2,
    });
  });

  it('does not authorize stale, withdrawn, Guest, retired, or cross-learner keys', async () => {
    const { useCase, remediationTutor } = harness();
    await expect(useCase.execute({
      deviceId: 'DEV001', learnerKey: 1, actionKey: '1:old-action',
    })).resolves.toMatchObject({ status: 'unavailable', reason: 'stale_or_withdrawn' });
    await expect(useCase.execute({
      deviceId: 'DEV001', learnerKey: 2, actionKey: '1:remediation:REM_A',
    })).resolves.toMatchObject({ status: 'unavailable' });
    await expect(useCase.execute({
      deviceId: 'DEV001', learnerKey: 0, actionKey: 'guest',
    })).rejects.toMatchObject({ code: 'SCHOOLCALC_LEARNER_UNAVAILABLE' });
    expect(remediationTutor.get).not.toHaveBeenCalled();
  });

  it('fails closed if a remediation session belongs to another learner', async () => {
    const fixture = harness();
    fixture.remediationTutor.get.mockResolvedValueOnce({
      sessionId: 'REM_A', learnerId: 'kid-b', status: 'offered',
      cursor: { nextClientSequence: 0, latestServerSequence: 0 },
    });
    await expect(fixture.useCase.execute({
      deviceId: 'DEV001', learnerKey: 1, actionKey: '1:remediation:REM_A',
    })).resolves.toMatchObject({ status: 'unavailable', reason: 'remediation_changed' });
  });
});
