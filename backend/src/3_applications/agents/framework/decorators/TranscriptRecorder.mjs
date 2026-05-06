/**
 * TranscriptRecorder — wraps a tool so every execute() call is recorded on
 * the active transcript with timing and ok/error status.
 *
 * No-op when context.transcript is missing.
 *
 * @type {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function transcriptRecorder(tool, context = {}) {
  const { transcript } = context;
  if (!transcript) return tool;

  return {
    ...tool,
    execute: async (args, ctx) => {
      const startedAt = Date.now();
      try {
        const result = await tool.execute(args, ctx);
        const ok = !(result && typeof result === 'object' && 'error' in result);
        transcript.recordTool({
          name: tool.name,
          args,
          result,
          ok,
          latencyMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        const errResult = { error: error.message };
        transcript.recordTool({
          name: tool.name,
          args,
          result: errResult,
          ok: false,
          latencyMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
  };
}

export default transcriptRecorder;
