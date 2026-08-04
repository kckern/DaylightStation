import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { GetSchoolCalcLearnerRoster } from './GetSchoolCalcLearnerRoster.mjs';

function device() {
  return SchoolCalcDevice.enroll({
    deviceId: 'DEV001', label: 'Calculator', platformId: 'future', catalogId: 'main',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
}

describe('GetSchoolCalcLearnerRoster', () => {
  it('persists stable bindings and projects Guest as explicitly non-persistent', async () => {
    let stored = device();
    const devices = {
      getDevice: vi.fn(async () => stored),
      saveDevice: vi.fn(async (next) => { stored = next; }),
    };
    const encodeLearnerRoster = vi.fn((value) => Buffer.from(JSON.stringify(value)));
    const useCase = new GetSchoolCalcLearnerRoster({
      devices,
      learners: { listLearners: () => [{ id: 'kid-a', name: 'Alpha' }, { id: 'kid-b', name: 'Beta' }] },
      codecs: { get: () => ({ encodeLearnerRoster }) },
      clock: () => new Date('2026-08-01T01:00:00.000Z'),
    });
    const first = await useCase.execute({ deviceId: 'DEV001' });
    expect(first).toMatchObject({
      schema: 'school.calc.learner-roster/v1', deviceId: 'DEV001',
      profiles: [
        { learnerKey: 1, learnerId: 'kid-a', label: 'Alpha' },
        { learnerKey: 2, learnerId: 'kid-b', label: 'Beta' },
      ],
      guest: { learnerKey: 0, persistent: false },
      deviceRevision: 1,
    });
    expect(devices.saveDevice).toHaveBeenCalledWith(stored, { expectedRevision: 0 });
    expect(encodeLearnerRoster).toHaveBeenCalledWith(expect.objectContaining({ generation: expect.stringMatching(/^sha256:/) }));

    devices.saveDevice.mockClear();
    const second = await useCase.execute({ deviceId: 'DEV001' });
    expect(second.generation).toBe(first.generation);
    expect(second.profiles).toEqual(first.profiles);
    expect(devices.saveDevice).not.toHaveBeenCalled();
  });
});
