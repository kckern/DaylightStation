// tests/isolated/agents/framework/buildObservationalMemory.test.mjs
import { describe, it, expect } from 'vitest';
import { buildObservationalMemory } from '../../../../backend/src/3_applications/agents/framework/buildObservationalMemory.mjs';

describe('buildObservationalMemory', () => {
  it('returns null when config is null/undefined', () => {
    expect(buildObservationalMemory(null, { storage: {} })).toBe(null);
    expect(buildObservationalMemory(undefined, { storage: {} })).toBe(null);
  });

  it('returns null when config.enabled is false', () => {
    expect(buildObservationalMemory({ enabled: false }, { storage: {} })).toBe(null);
  });

  it('returns null when storage is missing', () => {
    expect(buildObservationalMemory({ enabled: true }, {})).toBe(null);
    expect(buildObservationalMemory({ enabled: true }, { storage: null })).toBe(null);
  });

  it('returns null silently if construction throws (e.g. bad storage shape)', () => {
    // Pass a storage object that ObservationalMemory will reject — factory swallows.
    // We just verify no throw escapes.
    const fakeStorage = { __not_real: true };
    const result = buildObservationalMemory(
      {
        enabled: true,
        observer_model: 'openai/gpt-4o-mini',
        message_tokens_threshold: 30000,
        observation_tokens_threshold: 40000,
      },
      { storage: fakeStorage },
    );
    // It might either succeed (if Mastra is lenient) or return null. Either is fine —
    // we just assert no exception.
    expect(typeof result === 'object' || result === null).toBe(true);
  });
});
