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

    // Allow subclasses to store extra deps (include logger for tool factories)
    // Also expose agentRuntime so tests can inspect calls via agent.deps.agentRuntime
    this.deps = { ...rest, logger, agentRuntime };

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
    // userId may also be inside context (orchestrator path)
    const effectiveUserId = userId ?? context?.userId ?? null;
    const memory = effectiveUserId
      ? await this.#workingMemory.load(this.constructor.id, effectiveUserId)
      : null;

    const result = await this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: await this.#assemblePrompt(memory, context),
      context: { ...context, userId: effectiveUserId, memory },
    });

    if (memory) {
      await this.#workingMemory.save(this.constructor.id, effectiveUserId, memory);
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

  async #assemblePrompt(memory, context = {}) {
    const base = this.getSystemPrompt();
    const sections = [base];
    const attachmentsBlock = await this.formatAttachments(context.attachments);
    if (attachmentsBlock) sections.push(attachmentsBlock);
    if (memory) sections.push(`## Working Memory\n${memory.serialize()}`);
    return sections.join('\n\n');
  }

  /**
   * Render `context.attachments` into a system-prompt preamble. Default
   * implementation produces a `## User Mentions` block listing each
   * attachment via `formatAttachment`. Subclasses override `formatAttachment`
   * for richer per-type rendering, or override `formatAttachments` to
   * change the whole block structure.
   *
   * @param {Array<object>} attachments
   * @returns {Promise<string>}
   */
  async formatAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return '';
    const lines = [
      '## User Mentions',
      'The user\'s message refers to the following items. ' +
      'Use your tools to fetch data when relevant.',
      '',
      ...attachments.map(a => `- ${this.formatAttachment(a)}`),
    ];
    return lines.join('\n');
  }

  /**
   * Render a single attachment to a one-line string. Default is a generic
   * fallback; subclasses override for typed rendering.
   */
  formatAttachment(attachment) {
    const label = attachment?.label || '(no label)';
    const type = attachment?.type || 'unknown';
    // Include extra fields so raw data is visible to the model even without subclass override
    const extra = Object.entries(attachment || {})
      .filter(([k]) => k !== 'label' && k !== 'type')
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    return extra ? `\`${label}\` (${type}: ${extra})` : `\`${label}\` (${type})`;
  }
}
