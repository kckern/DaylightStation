// backend/src/3_applications/agents/ports/IAgentRuntime.mjs

/**
 * Port interface for agent execution runtime (framework-agnostic)
 * @interface IAgentRuntime
 */
export class IAgentRuntime {
  /**
   * Execute an agent with given input
   * @param {Object} options
   * @param {Object} options.agent - Agent instance
   * @param {string} options.input - User input / task description
   * @param {Array} options.tools - Available tools (ITool[])
   * @param {string} options.systemPrompt - Agent persona/instructions
   * @param {Object} [options.context] - Execution context (userId, etc.)
   * @param {Object} [options.memory] - Conversation memory (optional)
   * @returns {Promise<{output: string, toolCalls: Array}>}
   */
  async execute(_options) { throw new Error('IAgentRuntime.execute not implemented'); }

  /**
   * Execute agent in background (fire-and-forget with callback)
   * @param {Object} options - Same as execute
   * @param {Function} [onComplete] - Called when done with result or error
   * @returns {Promise<{taskId: string}>}
   */
  async executeInBackground(_options, _onComplete) { throw new Error('IAgentRuntime.executeInBackground not implemented'); }

  /**
   * Execute an agent with streaming output.
   * Yields normalized chunks: text-delta, tool-start, tool-end, finish.
   * @param {Object} options - Same shape as execute
   * @returns {AsyncIterable<{type: 'text-delta'|'tool-start'|'tool-end'|'finish', text?: string, toolName?: string, args?: object, result?: any, reason?: string, usage?: object}>}
   */
  async *streamExecute(_options) { throw new Error('IAgentRuntime.streamExecute not implemented'); }
}

/**
 * Type guard for IAgentRuntime
 * @param {any} obj
 * @returns {boolean}
 */
export function isAgentRuntime(obj) {
  return (
    obj &&
    typeof obj.execute === 'function' &&
    typeof obj.executeInBackground === 'function' &&
    typeof obj.streamExecute === 'function'
  );
}
