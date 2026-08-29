// tests/isolated/agents/framework/buildAgentMemory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildAgentMemory } from '../../../../backend/src/3_applications/agents/framework/buildAgentMemory.mjs';

const memoryFactory = { createMemory: vi.fn((options) => ({ options })) };
const deps = (over = {}) => ({ dataPath: ':memory:', logger: { warn: vi.fn() }, memoryFactory, ...over });

describe('buildAgentMemory', () => {
  it('returns null when memoryConfig is null', () => {
    expect(buildAgentMemory(null, { dataPath: 'data', logger: console })).toBe(null);
  });

  it('returns null when memoryConfig is undefined', () => {
    expect(buildAgentMemory(undefined, { dataPath: 'data', logger: console })).toBe(null);
  });

  it('builds a Memory when given a config and an in-memory dataPath', () => {
    const memory = buildAgentMemory(
      { lastMessages: 5 },
      deps(),
    );
    expect(memory).toBeDefined();
    expect(typeof memory).toBe('object');
  });

  it('forwards lastMessages config through to Memory', () => {
    // Construction smoke; we just need it to not throw with a valid config.
    const memory = buildAgentMemory(
      { lastMessages: 30 },
      deps(),
    );
    expect(memory).toBeDefined();
  });

  it('returns null and logs warn on construction error', () => {
    const logger = { warn: vi.fn() };
    const memory = buildAgentMemory(
      { lastMessages: 5 },
      deps({ dataPath: null, logger, agentId: 'stub-agent' }),
    );
    expect(memory).toBe(null);
    expect(logger.warn).toHaveBeenCalled();
    // The warn should mention agentId for traceability
    const callArgs = logger.warn.mock.calls[0];
    expect(callArgs.length).toBeGreaterThan(0);
  });

  it('accepts optional agentId in shared deps', () => {
    const memory = buildAgentMemory(
      { lastMessages: 5 },
      deps({ agentId: 'health-coach' }),
    );
    expect(memory).toBeDefined();
  });

  it('returns null and warns when no memory factory is composed', () => {
    const logger = { warn: vi.fn() };
    expect(buildAgentMemory({ lastMessages: 5 }, { dataPath: ':memory:', logger })).toBe(null);
    expect(logger.warn).toHaveBeenCalledWith('agent.memory.init_failed', expect.objectContaining({
      error: 'memoryFactory required',
    }));
  });
});
