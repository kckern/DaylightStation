import { describe, expect, it } from 'vitest';
import { createCoreLearningModuleRegistry } from './LearningModuleRegistry.mjs';

describe('LearningModuleRegistry', () => {
  it('validates portable graph configuration without TI variable knowledge', () => {
    const registry = createCoreLearningModuleRegistry();
    expect(registry.validate({
      type: 'tool', capability: 'graph@1',
      config: {
        equations: [{ slot: 'primary', expression: '2*x+1' }],
        window: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
      },
    }).errors).toEqual([]);
  });

  it('forbids executable lesson content and requires allowlisted logical program IDs', () => {
    const registry = createCoreLearningModuleRegistry();
    expect(registry.validate({
      type: 'tool', capability: 'native-program@1',
      config: { toolId: 'quadratic-helper', source: 'Disp 1' },
    }).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('source is forbidden'),
    ]));
  });

  it('requires custom capabilities to be explicitly registered with a schema', () => {
    const registry = createCoreLearningModuleRegistry({
      customDefinitions: [{
        capability: 'periodic-table@1', kind: 'custom',
        validateConfig: (config) => typeof config.datasetId === 'string' ? [] : ['datasetId is required'],
        interaction: {
          model: 'overview_detail', topology: 'grid', navigation: 'snap',
          inspector: 'stable', focusIdentity: 'item_id', positionMemory: 'stable_item',
          fallback: 'list', legend: 'info',
        },
      }],
    });
    expect(registry.validate({ type: 'custom', capability: 'periodic-table@1', config: { datasetId: 'elements-v1' } }).errors).toEqual([]);
    expect(registry.validate({ type: 'custom', capability: 'world-map@1', config: {} }).errors)
      .toEqual(["unregistered custom capability 'world-map@1'"]);
    expect(registry.list()).toEqual(expect.arrayContaining([expect.objectContaining({
      capability: 'periodic-table@1', kind: 'custom',
      interaction: expect.objectContaining({
        model: 'overview_detail', topology: 'grid', focusIdentity: 'item_id', fallback: 'list',
      }),
    })]));
  });

  it('rejects custom renderer definitions that omit the portable overview contract', () => {
    expect(() => createCoreLearningModuleRegistry({
      customDefinitions: [{
        capability: 'dense-reference@1', kind: 'custom', validateConfig: () => [],
      }],
    })).toThrow(/requires an interaction contract/);
    expect(() => createCoreLearningModuleRegistry({
      customDefinitions: [{
        capability: 'dense-reference@1', kind: 'custom', validateConfig: () => [],
        interaction: {
          model: 'overview_detail', topology: 'chemistry', navigation: 'snap',
          inspector: 'stable', focusIdentity: 'item_id', positionMemory: 'session',
          fallback: 'incompatible', legend: 'none',
        },
      }],
    })).toThrow(/topology must be grid\|ordered\|spatial\|relational/);
  });
});
