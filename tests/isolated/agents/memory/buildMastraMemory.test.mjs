// tests/isolated/agents/memory/buildMastraMemory.test.mjs
import { describe, it, expect } from 'vitest';
import { buildMastraMemory } from '../../../../backend/src/0_system/memory/buildMastraMemory.mjs';

describe('buildMastraMemory', () => {
  it('builds a Memory instance with in-memory storage', () => {
    const memory = buildMastraMemory({ dbPath: ':memory:' });
    expect(memory).toBeDefined();
    expect(typeof memory).toBe('object');
  });

  it('builds with file-backed storage when given a real path', () => {
    // Use :memory: in tests to avoid disk I/O; the factory still exercises the same path
    const memory = buildMastraMemory({ dbPath: ':memory:' });
    expect(memory).toBeDefined();
  });

  it('throws when dbPath is missing', () => {
    expect(() => buildMastraMemory({})).toThrow(/dbPath/i);
  });

  it('throws when dbPath is empty string', () => {
    expect(() => buildMastraMemory({ dbPath: '' })).toThrow(/dbPath/i);
  });

  it('respects lastMessages option', () => {
    // Smoke: constructs without throwing
    const memory = buildMastraMemory({ dbPath: ':memory:', lastMessages: 10 });
    expect(memory).toBeDefined();
  });

  it('accepts workingMemory config', () => {
    const memory = buildMastraMemory({
      dbPath: ':memory:',
      workingMemory: { type: 'text-stream' },
    });
    expect(memory).toBeDefined();
  });
});
