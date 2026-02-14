// backend/src/3_applications/agents/framework/BaseAgent.mjs

/**
 * BaseAgent - Common agent lifecycle.
 *
 * Handles memory load/save, tool factory aggregation, and assignment dispatch.
 * Subclasses define behavior via getSystemPrompt(), registerTools(), and registerAssignments().
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — BaseAgent section
 */
export class BaseAgent {
  static id;
  static description;

  #agentRuntime;
  #workingMemory;
  #logger;
  #toolFactories = [];
  #assignments = new Map();

  constructor({ agentRuntime, workingMemory, logger = console, ...rest }) {
    if (!agentRuntime) throw new Error('agentRuntime is required');
    if (!workingMemory) throw new Error('workingMemory is required');

    this.#agentRuntime = agentRuntime;
    this.#workingMemory = workingMemory;
    this.#logger = logger;

    // Allow subclasses to store extra deps
    this.deps = rest;

    // Let subclass register tool factories
    this.registerTools();
  }

  // --- Subclass contract ---
  getSystemPrompt() { throw new Error('Subclass must implement getSystemPrompt()'); }
  registerTools() { /* optional — subclass calls addToolFactory() here */ }

  // --- Tool factories ---
  addToolFactory(factory) {
    this.#toolFactories.push(factory);
  }

  getTools() {
    return this.#toolFactories.flatMap(f => f.createTools());
  }

  // --- Freeform run (chat-style) ---
  async run(input, { userId, context = {} } = {}) {
    const memory = userId
      ? await this.#workingMemory.load(this.constructor.id, userId)
      : null;

    const result = await this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: this.#assemblePrompt(memory),
      context: { ...context, userId, memory },
    });

    if (memory) {
      await this.#workingMemory.save(this.constructor.id, userId, memory);
    }

    return result;
  }

  // --- Assignment run (structured workflow) ---
  async runAssignment(assignmentId, { userId, context = {} } = {}) {
    const assignment = this.#assignments.get(assignmentId);
    if (!assignment) throw new Error(`Unknown assignment: ${assignmentId}`);

    return assignment.execute({
      agentRuntime: this.#agentRuntime,
      workingMemory: this.#workingMemory,
      tools: this.getTools(),
      systemPrompt: this.getSystemPrompt(),
      agentId: this.constructor.id,
      userId,
      context,
      logger: this.#logger,
    });
  }

  registerAssignment(assignment) {
    const id = assignment.constructor.id || assignment.id;
    this.#assignments.set(id, assignment);
  }

  getAssignments() {
    return [...this.#assignments.values()];
  }

  #assemblePrompt(memory) {
    const base = this.getSystemPrompt();
    if (!memory) return base;
    return `${base}\n\n## Working Memory\n${memory.serialize()}`;
  }
}
