// backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs
import { z } from 'zod';

/**
 * Health-coach working memory — Zod schema with .passthrough().
 *
 * The all-optional fields (.optional()) previously produced { type: "None" }
 * JSONSchema when Mastra converted them via its standardSchema bridge.
 * .passthrough() forces the schema to be treated as an open object, which
 * produces a valid type:'object' JSONSchema for OpenAI's tool function
 * validator (the inner `memory` field of the wrapped updateWorkingMemory
 * tool schema).
 *
 * Resource-scoped (set in HealthCoachAgent.getMemoryConfig): observations
 * are shared across all threads and agents for the same userId. Future
 * agents (lifeplan-guide, etc.) read these via the same scope.
 *
 * This is the LLM-maintained transient observation layer. Distinct from
 * our YAML-based playbooks/baselines (code-curated, structured) — different
 * problem, different solution.
 */
export const healthCoachWorkingMemorySchema = z.object({
  recent_focus_areas: z.array(z.string()).max(8).optional()
    .describe('What the user has mentioned focusing on lately (e.g., "Z2 endurance", "morning fasted runs"). Most recent first.'),
  recent_observations: z.array(z.string()).max(20).optional()
    .describe('Notable things the user has shared in recent conversations. Each entry should include a date if relevant.'),
  stated_goals: z.array(z.string()).max(5).optional()
    .describe('Long-term goals the user has explicitly stated.'),
  active_constraints: z.array(z.string()).max(5).optional()
    .describe('Current limitations or restrictions (injury, illness, life event). Each should include a start date if known.'),
  preferences: z.record(z.string(), z.string()).optional()
    .describe('Coaching preferences the user has expressed.'),
}).passthrough();

export default healthCoachWorkingMemorySchema;
