import { describe, expect, it, vi } from 'vitest';
import { BuildSchoolCalcInstallSet } from './BuildSchoolCalcInstallSet.mjs';

const addresses = [
  'main/general/course/unit/first',
  'main/general/course/unit/second',
];
const catalog = {
  schema: 'school.catalog/v1', catalogId: 'main', title: 'Main',
  subjects: [{
    subjectId: 'general', title: 'General', courses: [{
      courseId: 'course', title: 'Course', units: [{
        unitId: 'unit', title: 'Unit', lessons: [
          { lessonId: 'first', title: 'First', modules: [{ moduleId: 'one', type: 'examples', examples: [{ exampleId: 'e1', prompt: 'One', steps: ['One'] }] }] },
          { lessonId: 'second', title: 'Second', modules: [{ moduleId: 'two', type: 'examples', examples: [{ exampleId: 'e2', prompt: 'Two', steps: ['Two'] }] }] },
        ],
      }],
    }],
  }],
  installSets: [{ installSetId: 'starter', title: 'Starter', lessonAddresses: addresses }],
};

describe('BuildSchoolCalcInstallSet', () => {
  it('compiles one or more immutable artifacts in authored order', async () => {
    const execute = vi.fn(async ({ address }) => ({
      artifactId: `sc:future:${address.endsWith('first') ? 'FIRST' : 'SECOND'}`,
      byteLength: 10,
    }));
    const result = await new BuildSchoolCalcInstallSet({
      catalogs: { getCatalog: async () => catalog },
      buildArtifact: { execute },
    }).execute({ deviceId: 'DEV001', catalogId: 'main', installSetId: 'starter' });

    expect(execute.mock.calls.map(([input]) => input.address)).toEqual(addresses);
    expect(result).toMatchObject({
      schema: 'school.calc.install-set/v1', catalogId: 'main', installSetId: 'starter',
      lessonAddresses: addresses,
      artifactIds: ['sc:future:FIRST', 'sc:future:SECOND'],
    });
    expect(result.versionId).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('refuses a missing or invalid authored set before compilation', async () => {
    const execute = vi.fn();
    const useCase = new BuildSchoolCalcInstallSet({
      catalogs: { getCatalog: async () => catalog },
      buildArtifact: { execute },
    });
    await expect(useCase.execute({ deviceId: 'DEV001', catalogId: 'main', installSetId: 'missing' }))
      .rejects.toThrow(/install set.*not found/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
