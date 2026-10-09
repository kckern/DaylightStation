// tests/isolated/agents/memory/working_memory_schema.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemorySchema } from "../../../../modules/health/server/application/agents/health-coach/memory/workingMemorySchema.mjs";
import { userWorkingMemoryTemplate as healthCoachWorkingMemoryTemplate } from "#apps/agents/framework/userWorkingMemoryTemplate.mjs";

describe('healthCoachWorkingMemorySchema (deprecated; re-exports template)', () => {
  it('returns the same string as workingMemoryTemplate', () => {
    expect(healthCoachWorkingMemorySchema).toBe(healthCoachWorkingMemoryTemplate);
  });

  it('is a non-empty Markdown string starting with a top-level header', () => {
    expect(typeof healthCoachWorkingMemorySchema).toBe('string');
    expect(healthCoachWorkingMemorySchema).toMatch(/^# /);
  });
});
