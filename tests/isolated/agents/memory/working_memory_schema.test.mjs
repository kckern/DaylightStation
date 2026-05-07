// tests/isolated/agents/memory/working_memory_schema.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemorySchema } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs';

describe('healthCoachWorkingMemorySchema (JSONSchema7)', () => {
  it('is a valid JSONSchema with type: object at the top level', () => {
    expect(healthCoachWorkingMemorySchema.type).toBe('object');
  });

  it('exposes the expected top-level property keys', () => {
    const props = Object.keys(healthCoachWorkingMemorySchema.properties).sort();
    expect(props).toEqual([
      'active_constraints',
      'preferences',
      'recent_focus_areas',
      'recent_observations',
      'stated_goals',
    ]);
  });

  it('caps array sizes via maxItems', () => {
    expect(healthCoachWorkingMemorySchema.properties.recent_focus_areas.maxItems).toBe(8);
    expect(healthCoachWorkingMemorySchema.properties.recent_observations.maxItems).toBe(20);
    expect(healthCoachWorkingMemorySchema.properties.stated_goals.maxItems).toBe(5);
    expect(healthCoachWorkingMemorySchema.properties.active_constraints.maxItems).toBe(5);
  });

  it('array items are typed as string', () => {
    expect(healthCoachWorkingMemorySchema.properties.recent_focus_areas.items.type).toBe('string');
    expect(healthCoachWorkingMemorySchema.properties.recent_observations.items.type).toBe('string');
    expect(healthCoachWorkingMemorySchema.properties.stated_goals.items.type).toBe('string');
    expect(healthCoachWorkingMemorySchema.properties.active_constraints.items.type).toBe('string');
  });

  it('preferences is an object whose additionalProperties are string', () => {
    const p = healthCoachWorkingMemorySchema.properties.preferences;
    expect(p.type).toBe('object');
    expect(p.additionalProperties.type).toBe('string');
  });

  it('does not declare any required fields (all optional)', () => {
    // The previous bug: all-optional Zod produced { "type": "None" } JSONSchema.
    // Now we control the JSONSchema directly — `type: 'object'` is explicit
    // so the OpenAI tool function schema is valid even with no required[].
    expect(healthCoachWorkingMemorySchema.required).toBeUndefined();
  });

  it('is JSON-serializable (round-trips through JSON.stringify/parse)', () => {
    const json = JSON.stringify(healthCoachWorkingMemorySchema);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('object');
    expect(parsed.properties.recent_focus_areas.maxItems).toBe(8);
  });

  it('every property has a description (helps the LLM populate it correctly)', () => {
    for (const [, prop] of Object.entries(healthCoachWorkingMemorySchema.properties)) {
      expect(typeof prop.description).toBe('string');
      expect(prop.description.length).toBeGreaterThan(20);
    }
  });
});
