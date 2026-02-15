// backend/src/3_applications/agents/framework/Assignment.mjs

/**
 * Assignment - Base class for structured multi-step agent workflows.
 *
 * Template method pattern: gather → buildPrompt → reason → validate → act
 * Memory load/save is handled by the framework (this base class).
 * Subclasses implement the five phase methods.
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — Assignment section
 */
export class Assignment {
  static id;
  static description;
  static schedule; // cron expression, used by Scheduler

  /**
   * Execute the assignment lifecycle.
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation
   * @param {Object} deps.workingMemory - IWorkingMemory implementation
   * @param {Array} deps.tools - ITool[] available to the agent
   * @param {string} deps.systemPrompt - Agent system prompt
   * @param {string} deps.agentId - Agent identifier
   * @param {string} deps.userId - User identifier
   * @param {Object} deps.context - Execution context
   * @param {Object} deps.logger - Logger
   * @returns {Promise<any>} Validated output
   */
  async execute({ agentRuntime, workingMemory, tools, systemPrompt, agentId, userId, context, logger }) {
    // 1. Load memory
    const memory = await workingMemory.load(agentId, userId);
    memory.pruneExpired();

    // 2. Gather — programmatic data collection
    const gathered = await this.gather({ tools, userId, memory, logger });

    // 3. Build prompt — context engineering
    const prompt = this.buildPrompt(gathered, memory);

    // 4. Reason — LLM call
    const raw = await agentRuntime.execute({
      agentId,
      input: prompt,
      tools,
      systemPrompt,
      context: { userId, ...context },
    });

    // 5. Validate — schema + domain checks
    const validated = await this.validate(raw, gathered, logger);

    // 6. Act — write output, update memory
    await this.act(validated, { memory, userId, logger });

    // 7. Save memory
    await workingMemory.save(agentId, userId, memory);

    logger.info?.('assignment.complete', {
      agentId,
      assignmentId: this.constructor.id,
      userId,
    });

    return validated;
  }

  // --- Subclass contract ---
  async gather(deps) { throw new Error('Subclass must implement gather()'); }
  buildPrompt(gathered, memory) { throw new Error('Subclass must implement buildPrompt()'); }
  getOutputSchema() { throw new Error('Subclass must implement getOutputSchema()'); }
  async validate(raw, gathered, logger) { throw new Error('Subclass must implement validate()'); }
  async act(validated, deps) { throw new Error('Subclass must implement act()'); }
}
