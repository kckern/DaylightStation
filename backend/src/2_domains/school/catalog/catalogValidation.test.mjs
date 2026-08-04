import { describe, expect, it } from 'vitest';
import { listCatalogInstallSets, listCatalogLessons, validateLearningCatalog } from './index.mjs';

const catalog = {
  schema: 'school.catalog/v1', catalogId: 'home-school', title: 'Home School',
  subjects: [{
    subjectId: 'quantitative', title: 'Quantitative Studies',
    courses: [{
      courseId: 'intro-physics', title: 'Introductory Physics',
      units: [{
        unitId: 'kinematics', title: 'Kinematics',
        lessons: [{
          lessonId: 'constant-velocity', title: 'Constant velocity',
          objectives: ['Relate displacement, time, and velocity.'],
          requiredCapabilities: ['math@1'],
          modules: [
            { moduleId: 'notes', type: 'lecture_notes', documentId: 'velocity-notes' },
            { moduleId: 'examples', type: 'examples', examples: [{ exampleId: 'cart', prompt: 'A cart travels 12 m in 3 s.', steps: ['v = d / t', 'v = 4 m/s'] }] },
            { moduleId: 'practice', type: 'problems', mode: 'drill', bankId: 'velocity-practice' },
            {
              moduleId: 'probe', type: 'learning_probe', bankId: 'velocity-probe',
              phase: 'check', difficulty: 2, conceptIds: ['average-speed'],
              feedback: { timing: 'immediate', onIncorrect: 'explain_then_retry', maxAttemptsPerItem: 2 },
            },
            { moduleId: 'check', type: 'quiz', bankId: 'velocity-quiz', passingPercent: 80 },
            { moduleId: 'graph', type: 'tool', capability: 'graph@1', config: { expression: '4X' } },
          ],
        }],
      }],
    }],
  }],
};

describe('School learning catalog', () => {
  it('accepts a subject-neutral catalog hierarchy and preserves authored order', () => {
    expect(validateLearningCatalog(catalog)).toMatchObject({ errors: [], catalog });
    expect(listCatalogLessons(catalog)[0]).toMatchObject({
      address: 'home-school/quantitative/intro-physics/kinematics/constant-velocity',
      capabilities: ['reader@1', 'examples@1', 'problems@1', 'learning-probe@1', 'quiz@1', 'graph@1', 'math@1'],
    });
  });

  it('rejects duplicate IDs within a hierarchy level', () => {
    const duplicate = structuredClone(catalog);
    duplicate.subjects[0].courses.push(structuredClone(duplicate.subjects[0].courses[0]));
    expect(validateLearningCatalog(duplicate).errors).toContain("subjects[0].courses[1].courseId: duplicate course 'intro-physics'");
  });

  it('rejects unknown module types instead of learning subject-specific branches', () => {
    const invalid = structuredClone(catalog);
    invalid.subjects[0].courses[0].units[0].lessons[0].modules[0].type = 'geography';
    expect(validateLearningCatalog(invalid).errors[0]).toMatch(/type must be one of/);
  });

  it('rejects malformed and duplicate explicit capability contracts', () => {
    const invalid = structuredClone(catalog);
    invalid.subjects[0].courses[0].units[0].lessons[0].requiredCapabilities = ['math@1', 'math@1', 'ti86'];
    const errors = validateLearningCatalog(invalid).errors;
    expect(errors.some((error) => error.includes("duplicate capability 'math@1'"))).toBe(true);
    expect(errors.some((error) => error.includes('must look like name@version'))).toBe(true);
  });

  it('validates delivery install sets without creating another learning level', () => {
    const withSet = structuredClone(catalog);
    withSet.installSets = [{
      installSetId: 'kinematics-starter',
      title: 'Kinematics starter',
      lessonAddresses: ['home-school/quantitative/intro-physics/kinematics/constant-velocity'],
    }];

    expect(validateLearningCatalog(withSet)).toMatchObject({ errors: [] });
    expect(listCatalogInstallSets(withSet)).toEqual(withSet.installSets);
    expect(listCatalogLessons(withSet)).toHaveLength(1);
  });

  it('rejects duplicate or dangling install-set lesson addresses', () => {
    const invalid = structuredClone(catalog);
    const missing = 'home-school/quantitative/intro-physics/kinematics/missing';
    invalid.installSets = [{
      installSetId: 'starter', title: 'Starter', lessonAddresses: [missing, missing],
    }];
    let errors = validateLearningCatalog(invalid).errors;
    expect(errors).toContain(`installSets[0].lessonAddresses[1]: duplicate lesson address '${missing}'`);

    invalid.installSets[0].lessonAddresses = [missing];
    errors = validateLearningCatalog(invalid).errors;
    expect(errors).toContain(`installSets[0].lessonAddresses[0]: unknown lesson '${missing}'`);
  });
});
