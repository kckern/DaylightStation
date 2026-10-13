// tests/isolated/agents/health-coach/workingMemoryTemplate.test.mjs
import { describe, it, expect } from 'vitest';
import { userWorkingMemoryTemplate as healthCoachWorkingMemoryTemplate } from "#apps/agents/framework/userWorkingMemoryTemplate.mjs";

describe('healthCoachWorkingMemoryTemplate', () => {
  it('is a non-empty string', () => {
    expect(typeof healthCoachWorkingMemoryTemplate).toBe('string');
    expect(healthCoachWorkingMemoryTemplate.length).toBeGreaterThan(100);
  });

  it('contains all the canonical sections', () => {
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Recent Focus Areas/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Stated Goals/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Active Constraints/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Recent Observations/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Coaching Preferences/);
  });

  it('starts with a top-level header', () => {
    expect(healthCoachWorkingMemoryTemplate).toMatch(/^# /);
  });

  it('lifeplan-guide template re-exports the same value', async () => {
    const m = await import("../../../../__app_modules/life/server/application/agents/lifeplan-guide/memory/workingMemoryTemplate.mjs");
    expect(m.lifeplanGuideWorkingMemoryTemplate).toBe(healthCoachWorkingMemoryTemplate);
  });
});
