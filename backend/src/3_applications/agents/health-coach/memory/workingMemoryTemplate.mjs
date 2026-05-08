// backend/src/3_applications/agents/health-coach/memory/workingMemoryTemplate.mjs

/**
 * Health-coach working memory — Markdown template.
 *
 * Mastra's WorkingMemory accepts either a Zod/JSONSchema (broken at
 * @mastra/memory@1.17.5 — produces { type: "None" }) or a Markdown
 * string template. The agent reads the current Markdown content,
 * rewrites the FULL string via the updateWorkingMemory tool when
 * the user shares new context, and the next turn sees the updated
 * content prepended to the system prompt.
 *
 * Resource-scoped (per HealthCoachAgent.getMemoryConfig): the SAME
 * Markdown is visible to lifeplan-guide and any future agent reading
 * the same userId's resource.
 *
 * Distinct from YAML playbooks (code-curated, structured patterns).
 * This is the LLM-maintained transient observation layer.
 */
export const healthCoachWorkingMemoryTemplate = `# User Context (LLM-maintained, shared across agents)

## Recent Focus Areas
<!-- What the user is working on now, e.g. "Z2 endurance", "morning fasted runs". Most recent first. List bullets. -->

## Stated Goals
<!-- Long-term goals the user has explicitly stated, e.g. "sub-3:30 marathon by October". -->

## Active Constraints
<!-- Current limits — injuries, illnesses, life events. Include start dates when known. -->

## Recent Observations
<!-- Notable things the user has shared in recent conversations. Include date for each entry. -->

## Coaching Preferences
<!-- Tone, depth, what to emphasize. -->
`;

export default healthCoachWorkingMemoryTemplate;
