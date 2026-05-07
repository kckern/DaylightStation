// backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs

import { z } from 'zod';

/**
 * Health coach working memory — LLM-maintained transient observations.
 *
 * Distinct from our YAML-based playbooks/baselines (code-curated, structured).
 * This is what the LLM notices in conversation and wants to remember across
 * turns without us having to write code to persist it.
 *
 * Resource-scoped: shared across all threads and agents for the same userId.
 * health-coach observations are visible to lifeplan-guide and any future agents.
 *
 * @example output
 * {
 *   recent_focus_areas: ["Z2 endurance", "morning fasted runs"],
 *   recent_observations: ["mentioned poor sleep on 2026-05-06"],
 *   stated_goals: ["sub-3:30 marathon by October"],
 *   active_constraints: ["sore left knee since 2026-05-01"],
 *   preferences: { tone: "direct" },
 * }
 */
export const healthCoachWorkingMemorySchema = z.object({
  recent_focus_areas: z.array(z.string()).max(8).optional()
    .describe('What the user has mentioned focusing on lately (e.g., "Z2 endurance", "morning fasted runs"). Most recent first.'),
  recent_observations: z.array(z.string()).max(20).optional()
    .describe('Notable things the user has shared in recent conversations (e.g., "mentioned poor sleep on 2026-05-06"). Each entry should include a date if relevant.'),
  stated_goals: z.array(z.string()).max(5).optional()
    .describe('Long-term goals the user has explicitly stated (e.g., "sub-3:30 marathon by October").'),
  active_constraints: z.array(z.string()).max(5).optional()
    .describe('Current limitations or restrictions (injury, illness, life event). Each should include a start date if known.'),
  preferences: z.record(z.string(), z.string()).optional()
    .describe('Coaching preferences the user has expressed (e.g., { "tone": "direct", "metric_priority": "HR over pace" }).'),
});

export default healthCoachWorkingMemorySchema;
