/**
 * Prefix string used in the limit-reached error envelope. Exported so
 * consumers (e.g. MastraAdapter) can detect limit errors without coupling
 * on the full message string.
 */
export const LIMIT_REACHED_MESSAGE_PREFIX = 'Tool call limit reached';

/**
 * Create a CallLimiter decorator factory. The factory returns a decorator
 * that shares a counter across all tools it wraps in one call. Wrapping a
 * tool twice (or wrapping multiple tools in one chain) shares the counter.
 *
 * @param {{ maxToolCalls?: number }} opts
 * @returns {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function createCallLimiter({ maxToolCalls = 50 } = {}) {
  const counter = { count: 0 };

  return function callLimiter(tool, context = {}) {
    return {
      ...tool,
      execute: async (args, ctx) => {
        counter.count += 1;
        if (counter.count > maxToolCalls) {
          const errMsg = `${LIMIT_REACHED_MESSAGE_PREFIX} (${maxToolCalls}). Aborting to prevent runaway costs.`;
          context.transcript?.recordTool({
            name: tool.name,
            args,
            result: { error: errMsg },
            ok: false,
            latencyMs: 0,
          });
          return { error: errMsg };
        }
        return tool.execute(args, ctx);
      },
    };
  };
}

export default createCallLimiter;
