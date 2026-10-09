// backend/src/3_applications/agents/framework/Assignment.mjs

/**
 * Assignment - Base class for structured multi-step agent workflows.
 *
 * Template method pattern: gather → buildPrompt → reason → validate → act
 * Subclasses implement the five phase methods.
 *
 * NOTE: assignments still use the per-agent YAML "working memory" store as
 * an operational scratchpad (e.g., "did the morning brief run today?",
 * "alerts sent today" counter, "last weekly digest" timestamp). This is
 * SEPARATE from free-form user context, which is owned by Mastra Memory
 * (resource-scoped, exposed to chat agents via updateWorkingMemory).
 */
export class Assignment {
  static id;
  static description;
  static schedule; // cron expression, used by Scheduler

  /**
   * Execute the assignment lifecycle.
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation
   * @param {Object} deps.workingMemory - Per-agent operational scratchpad (YAML)
   * @param {Array} deps.tools - ITool[] available to the agent
   * @param {string} deps.systemPrompt - Agent system prompt
   * @param {string} deps.agentId - Agent identifier
   * @param {string} deps.userId - User identifier
   * @param {Object} deps.context - Execution context
   * @param {Object} deps.logger - Logger
   * @returns {Promise<any>} Validated output
   */
  async execute({ agentRuntime, workingMemory, tools, systemPrompt, agentId, userId, context, logger }) {
    // 1. Load operational scratchpad
    const memory = await workingMemory.load(agentId, userId);
    memory.pruneExpired();

    // 2. Gather — programmatic data collection
    const gathered = await this.gather({ tools, userId, memory, logger, context });

    // 3. Build prompt — context engineering
    const prompt = this.buildPrompt(gathered, memory);

    if (prompt == null) {
      logger.info?.('assignment.skipped', { agentId, assignmentId: this.constructor.id, userId, reason: 'nothing_actionable' });
      await workingMemory.save(agentId, userId, memory);
      return null;
    }

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

    // 6. Act — write output, update scratchpad
    await this.act(validated, { memory, userId, logger });

    // 7. Save scratchpad
    await workingMemory.save(agentId, userId, memory);

    logger.info?.('assignment.complete', {
      agentId,
      assignmentId: this.constructor.id,
      userId,
    });

    return validated;
  }

  // --- Subclass contract ---
  // gather({ tools, userId, memory, logger, context }) — memory is the operational scratchpad
  async gather(deps) { throw new Error('Subclass must implement gather()'); }
  buildPrompt(gathered, memory) { throw new Error('Subclass must implement buildPrompt()'); }
  getOutputSchema() { throw new Error('Subclass must implement getOutputSchema()'); }
  async validate(raw, gathered, logger) { throw new Error('Subclass must implement validate()'); }
  async act(validated, deps) { throw new Error('Subclass must implement act()'); }
}
