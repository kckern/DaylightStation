import { describe, expect, it } from 'vitest';
import {
  capabilityForLearningModule,
  validateLearningModule,
  validateLearningProbeBank,
} from './moduleValidation.mjs';

describe('SchoolCalc learning-module contracts', () => {
  it('accepts and derives each closed generic activity mechanic', () => {
    const modules = [
      {
        moduleId: 'match', type: 'activity', mechanic: 'matching',
        config: { pairs: [{ left: 'one', right: '1' }, { left: 'two', right: '2' }] },
      },
      {
        moduleId: 'sort', type: 'activity', mechanic: 'sorting',
        config: {
          buckets: [{ bucketId: 'asset', label: 'Asset' }, { bucketId: 'liability', label: 'Liability' }],
          items: [
            { itemId: 'cash', label: 'Cash', bucketId: 'asset' },
            { itemId: 'loan', label: 'Loan', bucketId: 'liability' },
          ],
        },
      },
      {
        moduleId: 'sequence', type: 'activity', mechanic: 'sequencing',
        config: { items: [{ itemId: 'first', label: 'First' }, { itemId: 'second', label: 'Second' }] },
      },
      {
        moduleId: 'speed', type: 'activity', mechanic: 'timed_drill',
        config: { bankId: 'quant:arithmetic/facts', durationSeconds: 60, goalCount: 20 },
      },
      {
        moduleId: 'memory', type: 'activity', mechanic: 'memory',
        config: { pairs: [{ left: 'H', right: 'hydrogen' }, { left: 'He', right: 'helium' }] },
      },
    ];

    for (const module of modules) {
      expect(validateLearningModule(module).errors).toEqual([]);
      expect(capabilityForLearningModule(module)).toBe(`activity.${module.mechanic.replace('_', '-')}@1`);
    }
  });

  it('rejects malformed activity data and dangling sorting buckets', () => {
    const result = validateLearningModule({
      moduleId: 'sort', type: 'activity', mechanic: 'sorting',
      config: {
        buckets: [{ bucketId: 'yes', label: 'Yes' }, { bucketId: 'no', label: 'No' }],
        items: [
          { itemId: 'a', label: 'A', bucketId: 'missing' },
          { itemId: 'b', label: 'B', bucketId: 'yes' },
        ],
      },
    });
    expect(result.errors).toContain("module.config.items[0].bucketId: unknown bucket 'missing'");
  });

  it('accepts a subject-neutral custom renderer contract and rejects executable-shaped shortcuts', () => {
    expect(validateLearningModule({
      moduleId: 'elements', type: 'custom', capability: 'periodic-table@1',
      config: { datasetId: 'elements-v1' },
    }).errors).toEqual([]);
    expect(validateLearningModule({
      moduleId: 'program', type: 'ti-basic', source: 'Disp 1',
    }).errors[0]).toMatch(/type must be one of/);
  });

  it('defines a subject-neutral, immediately explained learning probe', () => {
    const module = {
      moduleId: 'concept-check', type: 'learning_probe', bankId: 'rates/check-1',
      phase: 'check', difficulty: 2, conceptIds: ['unit-rate'],
      feedback: {
        timing: 'immediate', onIncorrect: 'explain_then_retry', maxAttemptsPerItem: 2,
      },
    };
    expect(validateLearningModule(module).errors).toEqual([]);
    expect(capabilityForLearningModule(module)).toBe('learning-probe@1');
    expect(validateLearningProbeBank(module, {
      concepts: [{ conceptId: 'unit-rate', title: 'Unit rate' }],
      items: [{
        id: 'q1', concepts: ['unit-rate'],
        feedback: { explanation: 'Divide the total by the number of units.' },
      }],
    }).errors).toEqual([]);
  });

  it('fails a probe without concept binding, staged difficulty, or corrective explanation', () => {
    const module = {
      moduleId: 'concept-check', type: 'learning_probe', bankId: 'rates/check-1',
      phase: 'terminal', difficulty: 0, conceptIds: [], feedback: {},
    };
    expect(validateLearningModule(module).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/phase/), expect.stringMatching(/difficulty/),
      expect.stringMatching(/conceptIds/), expect.stringMatching(/timing/),
      expect.stringMatching(/onIncorrect/), expect.stringMatching(/maxAttemptsPerItem/),
    ]));
    expect(validateLearningProbeBank({ ...module, conceptIds: ['unit-rate'] }, {
      concepts: [{ conceptId: 'unit-rate', title: 'Unit rate' }],
      items: [{ id: 'q1', concepts: ['other'] }],
    }).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/bind at least one probe concept/),
      expect.stringMatching(/corrective feedback/),
    ]));
  });
});
