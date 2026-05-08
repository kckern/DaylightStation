// tests/isolated/agents/memory/working_memory_schema.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemorySchema } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs';
import { healthCoachWorkingMemoryTemplate } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemoryTemplate.mjs';

describe('healthCoachWorkingMemorySchema (deprecated; re-exports template)', () => {
  it('returns the same string as workingMemoryTemplate', () => {
    expect(healthCoachWorkingMemorySchema).toBe(healthCoachWorkingMemoryTemplate);
  });

  it('is a non-empty Markdown string starting with a top-level header', () => {
    expect(typeof healthCoachWorkingMemorySchema).toBe('string');
    expect(healthCoachWorkingMemorySchema).toMatch(/^# /);
  });
});
