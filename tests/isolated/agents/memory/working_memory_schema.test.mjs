// tests/isolated/agents/memory/working_memory_schema.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemorySchema } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs';

describe('healthCoachWorkingMemorySchema (Zod with passthrough)', () => {
  it('parses canonical shape', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      recent_focus_areas: ['Z2 endurance'],
      recent_observations: ['mentioned poor sleep on 2026-05-06'],
      stated_goals: ['sub-3:30 marathon by October'],
      active_constraints: ['sore left knee since 2026-05-01'],
      preferences: { tone: 'direct' },
    });
    expect(r.success).toBe(true);
  });

  it('parses empty object (all fields optional)', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('parses partial shape (one field set)', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      stated_goals: ['marathon under 3:30'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects oversized recent_focus_areas (>8 entries)', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      recent_focus_areas: Array(20).fill('x'),
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-string entries in arrays', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      recent_focus_areas: [123, 'valid'],
    });
    expect(r.success).toBe(false);
  });

  it('passthrough allows extra keys (LLM can add fields without strict rejection)', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      recent_focus_areas: ['Z2'],
      llm_added_field: 'whatever',
    });
    expect(r.success).toBe(true);
  });
});
