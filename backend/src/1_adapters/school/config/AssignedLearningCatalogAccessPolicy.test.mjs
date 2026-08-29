import { describe, expect, it } from 'vitest';
import { AssignedLearningCatalogAccessPolicy } from '#apps/school/services/AssignedLearningCatalogAccessPolicy.mjs';

const lessons = [
  lesson('main/math/fractions/u1/l1', 'fractions', 'u1'),
  lesson('main/math/fractions/u2/l2', 'fractions', 'u2'),
  lesson('main/science/chemistry/atoms/l1', 'chemistry', 'atoms'),
];

describe('AssignedLearningCatalogAccessPolicy', () => {
  it('shows only assigned courses/units and hides an unassigned learner and Guest', async () => {
    const records = {
      alpha: { courses: ['fractions'], units: [] },
      beta: { courses: [], units: [{ unitId: 'atoms', elective: false }] },
    };
    const policy = new AssignedLearningCatalogAccessPolicy({
      assignments: { get: async (id) => records[id] ?? null },
    });
    await expect(policy.resolve({
      learners: [{ learnerId: 'alpha' }, { learnerId: 'beta' }, { learnerId: 'gamma' }], lessons,
    })).resolves.toEqual({
      learners: [
        { learnerId: 'alpha', lessonAddresses: lessons.slice(0, 2).map(({ address }) => address) },
        { learnerId: 'beta', lessonAddresses: [lessons[2].address] },
        { learnerId: 'gamma', lessonAddresses: [] },
      ],
      guest: { lessonAddresses: [] },
    });
  });

  it('applies explicit school.yml include/exclude rules at address boundaries', async () => {
    const policy = new AssignedLearningCatalogAccessPolicy({
      assignments: { get: async () => null },
      config: {
        unassigned: 'visible',
        guest: { mode: 'none', include: ['main/science'] },
        learners: {
          alpha: { exclude: ['main/math/fractions/u2'], include: ['main/science/chemistry'] },
        },
      },
    });
    const resolved = await policy.resolve({ learners: [{ learnerId: 'alpha' }], lessons });
    expect(resolved.learners[0].lessonAddresses).toEqual([lessons[0].address, lessons[2].address]);
    expect(resolved.guest.lessonAddresses).toEqual([lessons[2].address]);
  });

  it('rejects wildcard or malformed policy rather than guessing', () => {
    expect(() => new AssignedLearningCatalogAccessPolicy({
      assignments: { get: async () => null },
      config: { guest: { include: ['main/**'] } },
    })).toThrow(/canonical Catalog address prefixes/);
  });
});

function lesson(address, courseId, unitId) {
  return { address, context: { courseId, unitId } };
}
