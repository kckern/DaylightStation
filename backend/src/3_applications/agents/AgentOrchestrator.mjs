// backend/src/3_applications/agents/AgentOrchestrator.mjs

import { ValidationError } from '#system/utils/errors/index.mjs';
import { ServiceNotFoundError } from '../common/errors/index.mjs';

/**
 * AgentOrchestrator - Central service for agent registration and invocation
 *
 * This is the entry point for all agent operations. API handlers, other
 * applications, and scheduled jobs use this to run agents.
 */

export class AgentOrchestrator {
  #agents = new Map();
  #agentRuntime;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps) {
    if (!deps.agentRuntime) {
      throw new ValidationError('agentRuntime is required', { field: 'agentRuntime' });
    }
    this.#agentRuntime = deps.agentRuntime;
    this.#logger = deps.logger || console;
  }

  /**
   * Register an agent (called at bootstrap)
   * @param {Function} AgentClass - Agent class with static id property
   * @param {Object} dependencies - Dependencies to inject into agent
   */
  register(AgentClass, dependencies) {
    if (!AgentClass.id) {
      throw new ValidationError('Agent class must have static id property', { field: 'id' });
    }

    const agent = new AgentClass({
      ...dependencies,
      agentRuntime: this.#agentRuntime,
      logger: this.#logger,
    });

    this.#agents.set(AgentClass.id, agent);
    this.#logger.info?.('agent.registered', { agentId: AgentClass.id });
  }

  /**
   * Run agent synchronously (wait for result)
   * @param {string} agentId - Agent identifier
   * @param {string} input - User input / task description
   * @param {Object} [context={}] - Execution context (userId, etc.)
   * @returns {Promise<{output: string, toolCalls: Array}>}
   */
  async run(agentId, input, context = {}) {
    const agent = this.#getAgent(agentId);

    this.#logger.info?.('orchestrator.run', { agentId, contextKeys: Object.keys(context) });

    return agent.run(input, { context });
  }

  /**
   * Run agent in background (returns immediately)
   * @param {string} agentId - Agent identifier
   * @param {string} input - User input / task description
   * @param {Object} [context={}] - Execution context
   * @returns {Promise<{taskId: string}>}
   */
  async runInBackground(agentId, input, context = {}) {
    const agent = this.#getAgent(agentId);

    this.#logger.info?.('orchestrator.runInBackground', { agentId });

    return this.#agentRuntime.executeInBackground(
      {
        agent,
        input,
        tools: agent.getTools(),
        systemPrompt: agent.getSystemPrompt(),
        context,
      },
      (result) => {
        this.#logger.info?.('orchestrator.background.complete', {
          agentId,
          hasError: !!result.error,
        });
      }
    );
  }

  /**
   * List available agents (for discovery/admin)
   * @returns {Array<{id: string, description: string}>}
   */
  list() {
    return Array.from(this.#agents.values()).map((agent) => ({
      id: agent.constructor.id,
      description: agent.constructor.description || '',
    }));
  }

  /**
   * Check if an agent is registered
   * @param {string} agentId
   * @returns {boolean}
   */
  has(agentId) {
    return this.#agents.has(agentId);
  }

  /**
   * Get agent instance (internal)
   * @param {string} agentId
   * @returns {Object}
   */
  #getAgent(agentId) {
    const agent = this.#agents.get(agentId);
    if (!agent) {
      throw new ServiceNotFoundError('Agent', agentId);
    }
    return agent;
  }
}

export default AgentOrchestrator;
