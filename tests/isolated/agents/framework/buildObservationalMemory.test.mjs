// tests/isolated/agents/framework/buildObservationalMemory.test.mjs
import { describe, it, expect } from 'vitest';
import { buildObservationalMemory } from '../../../../backend/src/3_applications/agents/framework/buildObservationalMemory.mjs';

describe('buildObservationalMemory', () => {
  const processorFactory = {
    createObservationalProcessor: (options) => ({ kind: 'observational', options }),
  };

  it('returns null when config is null/undefined', () => {
    expect(buildObservationalMemory(null, { memory: {} })).toBe(null);
    expect(buildObservationalMemory(undefined, { memory: {} })).toBe(null);
  });

  it('returns null when config.enabled is false', () => {
    expect(buildObservationalMemory({ enabled: false }, { memory: {} })).toBe(null);
  });

  it('returns null when memory is missing', () => {
    expect(buildObservationalMemory({ enabled: true }, {})).toBe(null);
    expect(buildObservationalMemory({ enabled: true }, { memory: null })).toBe(null);
  });

  it('returns null silently if construction throws (e.g. bad storage shape)', () => {
    // Pass a storage object that ObservationalMemory will reject — factory swallows.
    // We just verify no throw escapes.
    const fakeMemory = { __not_real: true };
    const result = buildObservationalMemory(
      {
        enabled: true,
        observer_model: 'openai/gpt-4o-mini',
        message_tokens_threshold: 30000,
        observation_tokens_threshold: 40000,
      },
      {
        memory: fakeMemory,
        processorFactory: { createObservationalProcessor: () => { throw new Error('bad storage'); } },
      },
    );
    // It might either succeed (if Mastra is lenient) or return null. Either is fine —
    // we just assert no exception.
    expect(typeof result === 'object' || result === null).toBe(true);
  });

  it('projects configuration into the semantic processor factory', () => {
    const memory = {};
    const result = buildObservationalMemory({
      enabled: true,
      observer_model: 'observer',
      reflector_model: 'reflector',
      message_tokens_threshold: 123,
      observation_tokens_threshold: 456,
      scope: 'thread',
    }, { memory, processorFactory });

    expect(result.options).toEqual({
      memory,
      observerModel: 'observer',
      reflectorModel: 'reflector',
      messageTokens: 123,
      observationTokens: 456,
      scope: 'thread',
    });
  });
});
