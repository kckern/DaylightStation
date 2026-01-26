// backend/src/3_applications/agents/echo/EchoAgent.mjs

/**
 * EchoAgent - A simple demonstration agent
 *
 * This agent demonstrates the agent framework patterns:
 * - Static id and description
 * - Tool definitions via getTools()
 * - System prompt via getSystemPrompt()
 * - Dependency injection via constructor
 */

import { createTool } from '../ports/ITool.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class EchoAgent {
  static id = 'echo';
  static description = 'Simple demonstration agent that echoes messages and tells time';

  #agentRuntime;
  #logger;
  #timestampFn;

  /**
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation
   * @param {Function} [deps.timestampFn] - Function returning current timestamp string
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps) {
    if (!deps.agentRuntime) {
      throw new Error('agentRuntime is required');
    }
    this.#agentRuntime = deps.agentRuntime;
    this.#timestampFn = deps.timestampFn || (() => new Date().toISOString());
    this.#logger = deps.logger || console;
  }

  /**
   * Get tools available to this agent
   * @returns {Array<ITool>}
   */
  getTools() {
    return [
      createTool({
        name: 'echo_message',
        description: 'Echo a message back with a timestamp prefix',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to echo',
            },
          },
          required: ['message'],
        },
        execute: async ({ message }, context) => {
          const timestamp = this.#timestampFn();
          const echoedMessage = `[${timestamp}] Echo: ${message}`;
          this.#logger.info?.('echo.tool.executed', { message, context });
          return { echoed: echoedMessage };
        },
      }),

      createTool({
        name: 'get_current_time',
        description: 'Get the current date and time',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: async (params, context) => {
          const timestamp = this.#timestampFn();
          return { currentTime: timestamp };
        },
      }),
    ];
  }

  /**
   * Get system prompt for this agent
   * @returns {string}
   */
  getSystemPrompt() {
    return systemPrompt;
  }

  /**
   * Run the agent with given input
   * @param {string} input - User message
   * @param {Object} [options={}]
   * @param {Object} [options.context] - Execution context
   * @returns {Promise<{output: string, toolCalls: Array}>}
   */
  async run(input, options = {}) {
    return this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: this.getSystemPrompt(),
      context: options.context || {},
    });
  }
}

export default EchoAgent;
