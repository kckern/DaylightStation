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
  /**
   * Return the agent's base system prompt as a string or Promise<string>.
   * Subclasses MAY accept a `context` object (with userId/mode/etc.) to
   * branch on. Agents that ignore the arg keep working — backwards-compatible.
   */
  getSystemPrompt(context = {}) { throw new Error('Subclass must implement getSystemPrompt()'); }
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
    // Extract messages from context so it travels as a peer field, not nested inside context.
    const { messages: rawMessages, ...restContext } = context || {};
    const messages = Array.isArray(rawMessages) ? rawMessages : [];
    const augmentedContext = { mode: 'chat', ...restContext, userId: effectiveUserId };

    const memory = effectiveUserId
      ? await this.#workingMemory.load(this.constructor.id, effectiveUserId)
      : null;

    const result = await this.#agentRuntime.execute({
      agent: this,
      input,
      messages,
      tools: this.getTools(),
      systemPrompt: await this.#assemblePrompt(memory, augmentedContext),
      context: { ...augmentedContext, memory },
    });

    if (memory) {
      await this.#workingMemory.save(this.constructor.id, effectiveUserId, memory);
    }

    return result;
  }

  /**
   * Streaming variant of run. Yields chunks from the agent runtime as the
   * model produces them. Same userId resolution + assemble-prompt flow as
   * run(); memory is saved in a finally block so it persists even if the
   * consumer abandons the stream early (e.g. SSE client disconnects).
   *
   * @yields { type: 'text-delta'|'tool-start'|'tool-end'|'finish', ... }
   */
  async *runStream(input, { userId, context = {} } = {}) {
    const effectiveUserId = userId ?? context?.userId ?? null;
    // Extract messages from context so it travels as a peer field, not nested inside context.
    const { messages: rawMessages, ...restContext } = context || {};
    const messages = Array.isArray(rawMessages) ? rawMessages : [];
    const augmentedContext = { mode: 'chat', ...restContext, userId: effectiveUserId };

    const memory = effectiveUserId
      ? await this.#workingMemory.load(this.constructor.id, effectiveUserId)
      : null;

    const stream = this.#agentRuntime.streamExecute({
      agent: this,
      input,
      messages,
      tools: this.getTools(),
      systemPrompt: await this.#assemblePrompt(memory, augmentedContext),
      context: { ...augmentedContext, memory },
    });

    try {
      for await (const chunk of stream) {
        yield chunk;
      }
    } finally {
      if (memory) {
        await this.#workingMemory.save(this.constructor.id, effectiveUserId, memory);
      }
    }
  }

  // --- Assignment run (structured workflow) ---
  async runAssignment(assignmentId, { userId, context = {} } = {}) {
    const assignment = this.#assignments.get(assignmentId);
    if (!assignment) throw new Error(`Unknown assignment: ${assignmentId}`);

    const augmentedContext = { mode: 'dashboard', ...context };
    const systemPrompt = await this.getSystemPrompt(augmentedContext);

    return assignment.execute({
      agentRuntime: this.#agentRuntime,
      workingMemory: this.#workingMemory,
      tools: this.getTools(),
      systemPrompt,
      agentId: this.constructor.id,
      userId,
      context: augmentedContext,
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

  /**
   * buildToolDecorators — override in subclasses to inject additional
   * ToolDecorators into the chain before the framework defaults
   * (UserIdInjector, CallLimiter, TranscriptRecorder).
   *
   * The returned decorators run BEFORE the framework defaults — i.e. the
   * leftmost in the final chain. At call time, the outermost decorator
   * runs first.
   *
   * @returns {import('./decorators/ToolDecorator.mjs').ToolDecorator[]}
   */
  buildToolDecorators() {
    return [];
  }

  /**
   * Build the array of prompt sections that get joined to form the system
   * prompt. Override to add, remove, or reorder sections in subclasses.
   *
   * Default returns four sections (any may be null/empty — they're filtered):
   * 1. Base prompt from getSystemPrompt(context)
   * 2. "## Active User" if context.userId present
   * 3. "## User Mentions" from formatAttachments() if attachments present
   * 4. "## Working Memory" from memory.serialize() if memory present
   *
   * @param {object} context
   * @param {import('./WorkingMemory.mjs').WorkingMemoryState|null} memory
   * @returns {Promise<Array<string|null>>}
   */
  async buildPromptSections(context = {}, memory = null) {
    const sections = [await this.getSystemPrompt(context)];
    if (context.userId) {
      sections.push(`## Active User\nThe user you are assisting is: **${context.userId}**`);
    }
    const attachmentsBlock = await this.formatAttachments(context.attachments);
    if (attachmentsBlock) sections.push(attachmentsBlock);
    if (memory) sections.push(`## Working Memory\n${memory.serialize()}`);
    return sections;
  }

  async #assemblePrompt(memory, context = {}) {
    const sections = await this.buildPromptSections(context, memory);
    return sections.filter(Boolean).join('\n\n');
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
