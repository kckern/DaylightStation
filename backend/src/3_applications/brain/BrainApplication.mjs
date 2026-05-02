import { SkillRegistry } from './services/SkillRegistry.mjs';
import { BrainAgent } from './BrainAgent.mjs';

/**
 * BrainApplication — composition root + IChatCompletionRunner.
 *
 * The caller is responsible for instantiating skills (so the bootstrap layer
 * can pass adapter dependencies into each one without an async import here).
 */
export class BrainApplication {
  #registry;
  #agent;
  #logger;

  constructor({
    satelliteRegistry,
    memory,
    policy,
    agentRuntime,
    skills = [],
    logger = console,
  }) {
    if (!satelliteRegistry) throw new Error('BrainApplication: satelliteRegistry required');
    this.#registry = satelliteRegistry;
    this.#logger = logger;

    const registry = new SkillRegistry({ logger });
    for (const skill of skills) registry.register(skill);

    this.#agent = new BrainAgent({ agentRuntime, memory, policy, skills: registry, logger });
  }

  get satelliteRegistry() { return this.#registry; }

  /**
   * @param {Object} params
   * @param {Object} params.satellite - Satellite (already authenticated)
   * @param {Array} params.messages - OpenAI-shaped messages
   * @param {Array} [params.tools] - Tools from caller (intentionally ignored — see Spec §3.2)
   * @param {string} [params.conversationId]
   */
  async runChat({ satellite, messages, tools: _tools = [], conversationId = null, transcript = null }) {
    return this.#agent.runChat({ satellite, messages, conversationId, transcript });
  }

  async *streamChat({ satellite, messages, tools: _tools = [], conversationId = null, transcript = null }) {
    yield* this.#agent.streamChat({ satellite, messages, conversationId, transcript });
  }
}

export default BrainApplication;
