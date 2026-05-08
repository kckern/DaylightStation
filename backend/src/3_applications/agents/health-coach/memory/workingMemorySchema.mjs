// backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs
//
// DEPRECATED. Replaced by workingMemoryTemplate.mjs (Markdown template mode).
// The Zod/JSONSchema approach hit a bug in @mastra/memory@1.17.5 where the
// standardSchema → JSONSchema conversion produces { type: "None" }, which
// OpenAI's tool function validator rejects.
//
// Re-exporting the template under the old name keeps any callers that import
// healthCoachWorkingMemorySchema working — they now get the template string.
// Update those callers to import from workingMemoryTemplate.mjs going forward.

export { healthCoachWorkingMemoryTemplate as healthCoachWorkingMemorySchema } from './workingMemoryTemplate.mjs';
export { default } from './workingMemoryTemplate.mjs';
