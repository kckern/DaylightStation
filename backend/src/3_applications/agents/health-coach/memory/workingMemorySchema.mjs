// backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs

/**
 * Health-coach working memory — JSON Schema (Draft 7).
 *
 * Mastra's SchemaWorkingMemory accepts both ZodObject and JSONSchema7.
 * We use JSONSchema7 directly to avoid a Zod-to-JSONSchema conversion
 * issue in @mastra/memory@1.17.5 where all-optional Zod schemas produce
 * { type: "None" } — rejected by OpenAI's tool-function validator with:
 *   "Invalid schema for function 'updateWorkingMemory': schema must be
 *    a JSON Schema of 'type: \"object\"', got 'type: \"None\"'"
 *
 * Resource-scoped (set in HealthCoachAgent.getMemoryConfig): observations
 * are shared across all threads and agents for the same userId. Future
 * agents (lifeplan-guide, etc.) can read these via the same scope.
 *
 * This is the LLM-maintained transient observation layer. Distinct from
 * our YAML-based playbooks/baselines (code-curated, structured) — different
 * problem, different solution.
 */
export const healthCoachWorkingMemorySchema = {
  type: 'object',
  properties: {
    recent_focus_areas: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 8,
      description: 'What the user has mentioned focusing on lately (e.g., "Z2 endurance", "morning fasted runs"). Most recent first.',
    },
    recent_observations: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
      description: 'Notable things the user has shared in recent conversations. Each entry should include a date if relevant (e.g., "mentioned poor sleep on 2026-05-06").',
    },
    stated_goals: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description: 'Long-term goals the user has explicitly stated (e.g., "sub-3:30 marathon by October").',
    },
    active_constraints: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description: 'Current limitations or restrictions (injury, illness, life event). Each should include a start date if known.',
    },
    preferences: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Coaching preferences the user has expressed (e.g., { "tone": "direct", "metric_priority": "HR over pace" }).',
    },
  },
};

export default healthCoachWorkingMemorySchema;
