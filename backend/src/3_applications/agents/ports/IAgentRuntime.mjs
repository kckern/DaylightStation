// backend/src/3_applications/agents/ports/IAgentRuntime.mjs

/**
 * Port interface for agent execution runtime (framework-agnostic)
 * @interface IAgentRuntime
 */
export const IAgentRuntime = {
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
  async execute(options) {},

  /**
   * Execute agent in background (fire-and-forget with callback)
   * @param {Object} options - Same as execute
   * @param {Function} [onComplete] - Called when done with result or error
   * @returns {Promise<{taskId: string}>}
   */
  async executeInBackground(options, onComplete) {},
};

/**
 * Type guard for IAgentRuntime
 * @param {any} obj
 * @returns {boolean}
 */
export function isAgentRuntime(obj) {
  return (
    obj &&
    typeof obj.execute === 'function' &&
    typeof obj.executeInBackground === 'function'
  );
}
