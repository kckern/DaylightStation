/**
 * ToolDecorator — interface contract for tool wrappers.
 *
 * A decorator transforms an ITool into another ITool, typically by replacing
 * `execute` with a wrapped version that adds cross-cutting behavior (logging,
 * timing, policy gates, schema rewriting).
 *
 * Decorators compose: applyDecorators([A, B, C]) wraps the tool with A first,
 * then B around A's output, then C around B's output. The outermost decorator
 * runs first when execute() is called.
 *
 * @typedef {import('../ports/ITool.mjs').ITool} ITool
 * @typedef {object} ToolContext
 * @property {string} [agentId]
 * @property {string} [userId]
 * @property {object} [transcript]
 * @property {object} [memory]
 * @property {object} [satellite]   — concierge only (Plan B)
 * @property {object} [policy]      — concierge only (Plan B)
 *
 * @typedef {(tool: ITool, context: ToolContext) => ITool} ToolDecorator
 */

/**
 * No-op decorator — returns the tool unchanged. Useful as a default in tests
 * and as a contract example.
 */
export const identityDecorator = (tool) => tool;

/**
 * Type guard: a decorator is a function of arity ≤ 2.
 */
export function isToolDecorator(value) {
  return typeof value === 'function' && value.length <= 2;
}
