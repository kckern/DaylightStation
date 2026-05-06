/**
 * Strip userId from a JSON Schema (object schema). Idempotent — returns the
 * schema unchanged if userId is absent. Returns null/undefined unchanged.
 *
 * @param {object|null|undefined} schema
 * @returns {object|null|undefined}
 */
export function stripUserIdFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (!schema.properties || !('userId' in schema.properties)) return schema;
  const { userId: _, ...rest } = schema.properties;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((k) => k !== 'userId')
    : schema.required;
  return { ...schema, properties: rest, ...(required !== undefined ? { required } : {}) };
}

/**
 * UserIdInjector — wraps a tool so that:
 * 1. The wrapped tool's parameters schema has `userId` removed (the LLM
 *    doesn't need to supply it — the context provides it).
 * 2. At execute time, `context.userId` is injected into args before calling
 *    the underlying tool.
 *
 * Matches the ToolDecorator contract: `(tool, context) => wrappedTool`.
 *
 * @type {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function userIdInjector(tool, context = {}) {
  return {
    ...tool,
    parameters: stripUserIdFromSchema(tool.parameters),
    execute: async (args, ctx) => {
      const merged = { ...args };
      if (context.userId) merged.userId = context.userId;
      return tool.execute(merged, { ...ctx, userId: context.userId });
    },
  };
}

export default userIdInjector;
