import { BASE_PROMPT, satellitePrompt, memoryPrompt, vocabularyPrompt, personalityPrompt } from './prompts/system.mjs';

export class ConciergeAgent {
  static id = 'concierge';

  #runtime;
  #memory;
  #policy;
  #skills;
  #vocabulary;
  #personality;
  #logger;

  constructor({ agentRuntime, memory, policy, skills, vocabulary = null, personality = null, logger = console }) {
    if (!agentRuntime?.execute || !agentRuntime?.streamExecute) {
      throw new Error('ConciergeAgent: agentRuntime with execute() + streamExecute() required');
    }
    if (!memory) throw new Error('ConciergeAgent: memory (IConciergeMemory) required');
    if (!policy) throw new Error('ConciergeAgent: policy (IConciergePolicy) required');
    if (!skills) throw new Error('ConciergeAgent: skills (SkillRegistry) required');
    this.#runtime = agentRuntime;
    this.#memory = memory;
    this.#policy = policy;
    this.#skills = skills;
    this.#vocabulary = vocabulary;
    this.#personality = personality;
    this.#logger = logger;
  }

  async #buildContext(satellite, transcript = null) {
    const decision = this.#policy.evaluateRequest(satellite, {});
    if (!decision.allow) return { allowed: false, decision };

    const memorySnapshot = await this.#snapshotMemory();
    const tools = this.#skills.buildToolsFor(satellite, this.#policy, transcript);
    const prompt = [
      BASE_PROMPT,
      personalityPrompt(this.#personality),
      satellitePrompt(satellite),
      this.#skills.buildPromptFragmentsFor(satellite),
      vocabularyPrompt(this.#vocabulary),
      memoryPrompt(memorySnapshot),
    ].filter(Boolean).join('\n\n');

    this.#logger.debug?.('concierge.skills.resolved', {
      satellite_id: satellite.id,
      skills: satellite.allowedSkills,
      tool_count: tools.length,
    });

    return { allowed: true, prompt, tools };
  }

  async #snapshotMemory() {
    const notes = (await this.#memory.get('notes')) ?? [];
    const prefs = (await this.#memory.get('preferences')) ?? {};
    return { notes_recent: notes.slice(-5), preferences: prefs };
  }

  #refusalContent(reason) {
    const tail = reason ? ` — ${reason}` : '';
    return `I can't do that right now${tail}.`;
  }

  async runChat({ satellite, messages, conversationId = null, transcript = null }) {
    const ctx = await this.#buildContext(satellite, transcript);
    if (!ctx.allowed) {
      this.#logger.warn?.('concierge.policy.request_denied', {
        satellite_id: satellite.id,
        reason: ctx.decision.reason,
      });
      return { content: this.#refusalContent(ctx.decision.reason), toolCalls: [], usage: null };
    }
    const input = lastUserMessage(messages);
    const start = Date.now();
    this.#logger.info?.('concierge.runtime.start', { mode: 'gen', tool_count: ctx.tools.length });
    const result = await this.#runtime.execute({
      agentId: ConciergeAgent.id,
      input,
      tools: ctx.tools,
      systemPrompt: ctx.prompt,
      context: { satellite, conversationId },
    });
    const draft = result.output ?? '';
    const final = this.#policy.shapeResponse(satellite, draft);
    this.#logger.info?.('concierge.runtime.complete', {
      output_chars: final.length,
      tool_calls: result.toolCalls?.length ?? 0,
      latencyMs: Date.now() - start,
    });
    return { content: final, toolCalls: result.toolCalls ?? [], usage: result.usage ?? null };
  }

  async *streamChat({ satellite, messages, conversationId = null, transcript = null }) {
    const ctx = await this.#buildContext(satellite, transcript);
    if (!ctx.allowed) {
      yield { type: 'text-delta', text: this.#refusalContent(ctx.decision.reason) };
      yield { type: 'finish', reason: 'policy' };
      return;
    }
    const input = lastUserMessage(messages);
    this.#logger.info?.('concierge.runtime.start', { mode: 'stream', tool_count: ctx.tools.length });
    yield* this.#runtime.streamExecute({
      agentId: ConciergeAgent.id,
      input,
      tools: ctx.tools,
      systemPrompt: ctx.prompt,
      context: { satellite, conversationId },
    });
  }
}

function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      return messages[i].content;
    }
  }
  return '';
}

export default ConciergeAgent;
