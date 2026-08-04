import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { GetSchoolCalcProgressProjection } from './GetSchoolCalcProgressProjection.mjs';

function device() {
  return SchoolCalcDevice.enroll({
    deviceId: 'DEV001', label: 'Shared calculator', platformId: 'future', catalogId: 'main', createdAt: 'created',
  }).synchronizeLearners({
    synchronizedAt: '2026-08-02T00:00:00.000Z',
    learners: [{ id: 'kid-a', name: 'Alpha' }, { id: 'kid-b', name: 'Beta' }],
  }).device;
}

describe('GetSchoolCalcProgressProjection', () => {
  it('projects every active learner with stable device keys and omits Guest', async () => {
    const encodeProgressProjection = vi.fn(() => Buffer.from('progress'));
    const progress = { execute: vi.fn(async ({ scopeId }) => ({
      generatedAt: '2026-08-02T12:00:00.000Z',
      summary: {
        evidenceCount: scopeId === 'kid-a' ? 2 : 0,
        engagementCount: 2, responseCount: 5, correctCount: 4,
        completionCount: 1, durationMs: 0, activityCount: 1,
        assessmentCount: 1, verifiedCount: 2, selfReportedCount: 0,
        pendingCount: 0, scorePercent: 80, lastActivityAt: '2026-08-01T18:00:00.000Z',
      },
      curriculumHistory: { hierarchy: ['subject'], roots: [], unscoped: { evidenceCount: 0 } },
      recentScores: [{ assessmentId: 'quiz-1', score: { correct: 4, total: 5, percent: 80 } }],
      followUps: [{
        actionId: 'next:kid-a', kind: 'next_lesson', label: 'Next lesson',
        availability: 'ready', target: { type: 'lesson', id: 'lesson-2' }, priority: 20,
      }],
    })) };
    const useCase = new GetSchoolCalcProgressProjection({
      devices: { getDevice: async () => device() },
      progress,
      codecs: { get: () => ({ encodeProgressProjection }) },
    });

    const result = await useCase.execute({ deviceId: 'DEV001' });

    expect(progress.execute).toHaveBeenNthCalledWith(1, {
      scopeType: 'learner', scopeId: 'kid-a', recentLimit: 5,
      followUpContext: { surface: 'schoolcalc', endpointId: 'DEV001' },
    });
    expect(progress.execute).toHaveBeenNthCalledWith(2, {
      scopeType: 'learner', scopeId: 'kid-b', recentLimit: 5,
      followUpContext: { surface: 'schoolcalc', endpointId: 'DEV001' },
    });
    expect(result.profiles.map(({ learnerKey, learnerId }) => ({ learnerKey, learnerId }))).toEqual([
      { learnerKey: 1, learnerId: 'kid-a' },
      { learnerKey: 2, learnerId: 'kid-b' },
    ]);
    expect(result.profiles).not.toContainEqual(expect.objectContaining({ learnerKey: 0 }));
    expect(result.profiles[0].curriculumHistory).toEqual({
      hierarchy: ['subject'], roots: [], unscoped: { evidenceCount: 0 },
    });
    expect(result.generation).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.record).toEqual(Buffer.from('progress'));
    expect(encodeProgressProjection).toHaveBeenCalledWith(expect.objectContaining({
      schema: 'school.calc.progress-projection/v1', generation: result.generation,
    }));
  });

  it('keeps generation stable when only the generic report query time changes', async () => {
    let query = 0;
    const useCase = new GetSchoolCalcProgressProjection({
      devices: { getDevice: async () => device() },
      progress: { execute: async () => ({
        generatedAt: `2026-08-02T12:00:0${query++}.000Z`,
        summary: { evidenceCount: 0 }, recentScores: [], followUps: [],
      }) },
      codecs: { get: () => ({ encodeProgressProjection: () => Buffer.alloc(0) }) },
    });
    const first = await useCase.execute({ deviceId: 'DEV001' });
    const second = await useCase.execute({ deviceId: 'DEV001' });
    expect(second.generation).toBe(first.generation);
  });

  it('prioritizes learner-scoped adaptive remediation without exposing another learner session', async () => {
    const followUps = { listFollowUps: vi.fn(async ({ scope }) => [{
      actionId: `remediation:${scope.id}`, learnerId: scope.id,
      kind: 'remediation', label: 'Get tutor help', availability: 'requires_connection',
      target: { type: 'remediation_session', id: `rem-${scope.id}` }, priority: 10,
    }]) };
    const encodeProgressProjection = vi.fn(() => Buffer.from('progress'));
    const useCase = new GetSchoolCalcProgressProjection({
      devices: { getDevice: async () => device() },
      progress: { execute: async ({ scopeId }) => ({
        summary: { evidenceCount: 0 }, recentScores: [],
        followUps: [{
          actionId: `review:${scopeId}`, learnerId: scopeId, kind: 'review',
          label: 'Review', availability: 'ready', target: { type: 'bank', id: 'quiz' },
          priority: 30,
        }],
      }) },
      followUpSources: [followUps],
      codecs: { get: () => ({ encodeProgressProjection }) },
    });
    const result = await useCase.execute({ deviceId: 'DEV001' });
    expect(result.profiles[0].followUps.map(({ actionId }) => actionId)).toEqual([
      'remediation:kid-a', 'review:kid-a',
    ]);
    expect(result.profiles[1].followUps[0]).toMatchObject({
      learnerId: 'kid-b', target: { id: 'rem-kid-b' },
    });
    expect(followUps.listFollowUps).toHaveBeenNthCalledWith(1, expect.objectContaining({
      scope: expect.objectContaining({ learnerIds: ['kid-a'] }),
      deliveryContext: { surface: 'schoolcalc', endpointId: 'DEV001' },
    }));
  });
});
