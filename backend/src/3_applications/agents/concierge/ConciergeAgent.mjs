// backend/src/3_applications/agents/concierge/ConciergeAgent.mjs

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { policyDecorator } from '../framework/decorators/PolicyDecorator.mjs';
import {
  BASE_PROMPT,
  satellitePrompt,
  memoryPrompt,
  vocabularyPrompt,
  personalityPrompt,
} from './prompts/system.mjs';

/**
 * ConciergeAgent — household voice assistant consumed by HA Voice satellites.
 *
 * Extends BaseAgent, overriding:
 *   - buildToolDecorators: adds policyDecorator before framework defaults
 *   - registerTools: registers each ToolBundle via addToolFactory
 *   - buildPromptSections: 6-section prompt (base, personality, satellite,
 *       skill fragments, vocabulary, memory)
 *   - run/runStream: add request-level policy gate before super call
 *
 * Drops runChat/streamChat from the old ConciergeAgent — replaced by the
 * inherited run/runStream from BaseAgent.
 *
 * Design notes:
 * - toolBundles are passed through `...baseDeps` so they land in `this.deps`
 *   (set by BaseAgent constructor before registerTools() is called). This is
 *   the same pattern HealthCoachAgent uses for its factories.
 * - policy, vocabulary, and personality are also stored in deps for consistency
 *   with the pattern, and accessed as private-style getters.
 * - policy.shapeResponse(satellite, draft) was called by the old ConciergeAgent
 *   after the LLM call. Both policy implementations (ConciergePolicyEvaluator and
 *   PassThroughConciergePolicy) are no-ops that return draft unchanged, so it is
 *   intentionally omitted here.
 */
export class ConciergeAgent extends BaseAgent {
  static id = 'concierge';
  static description = 'Household voice assistant — consumed by HA Voice satellites';

  constructor({
    policy,
    toolBundles = [],
    vocabulary = null,
    personality = null,
    logger = console,
    ...baseDeps
  } = {}) {
    // Store toolBundles, policy, vocabulary, personality in deps so they are
    // accessible in registerTools() — which BaseAgent calls during super().
    super({ logger, toolBundles, policy, vocabulary, personality, ...baseDeps });
    if (!policy) throw new Error('ConciergeAgent: policy required');
  }

  // --- Convenience accessors (read from this.deps) ---

  get #policy() { return this.deps.policy; }
  get #vocabulary() { return this.deps.vocabulary; }
  get #personality() { return this.deps.personality; }

  /** @returns {Map<string, import('../framework/ToolBundle.mjs').ToolBundle>} */
  get #toolBundlesMap() {
    const bundles = this.deps.toolBundles ?? [];
    return new Map(bundles.map(b => [b.name, b]));
  }

  // --- BaseAgent overrides ---

  /**
   * ToolBundle satisfies the ToolFactory contract (both expose createTools()),
   * so we register each bundle via addToolFactory.
   *
   * Called by BaseAgent's constructor before the subclass constructor body runs,
   * so deps must be pre-populated (handled above via super()).
   */
  registerTools() {
    const bundles = this.deps.toolBundles ?? [];
    for (const bundle of bundles) {
      this.addToolFactory(bundle);
    }
  }

  buildToolDecorators() {
    return [policyDecorator];
  }

  /**
   * Build the 6 prompt sections for the concierge system prompt.
   *
   * Sections (some may be null/empty — BaseAgent filters them at join time):
   *   1. BASE_PROMPT — always present
   *   2. personalityPrompt — omitted when personality is null/empty
   *   3. satellitePrompt — omitted when no satellite in context
   *   4. skill fragments — joined fragments from allowed bundles; omitted if none
   *   5. vocabularyPrompt — omitted when vocabulary is null/empty
   *   6. memoryPrompt — omitted when memory snapshot is empty
   *
   * @param {object} context — agent context; may include satellite
   * @param {import('../framework/WorkingMemory.mjs').WorkingMemoryState|null} memory
   * @returns {Promise<Array<string|null>>}
   */
  async buildPromptSections(context = {}, memory = null) {
    const satellite = context?.satellite ?? null;
    const bundlesMap = this.#toolBundlesMap;
    const memorySnapshot = this.#snapshotMemory(memory);

    const skillFragments = satellite
      ? [...bundlesMap.values()]
          .filter(b => satellite.canUseSkill?.(b.name))
          .map(b => b.getPromptFragment?.(context) ?? null)
          .filter(Boolean)
          .join('\n\n')
      : null;

    return [
      BASE_PROMPT,
      personalityPrompt(this.#personality) || null,
      satellite ? satellitePrompt(satellite) : null,
      skillFragments || null,
      vocabularyPrompt(this.#vocabulary) || null,
      memorySnapshot ? memoryPrompt(memorySnapshot) : null,
    ];
  }

  // Note: getSystemPrompt is NOT implemented — ConciergeAgent goes entirely
  // through buildPromptSections (overriding the default which would call it).

  // --- Request-level policy gate ---

  async run(input, { context = {}, ...rest } = {}) {
    const satellite = context?.satellite ?? null;
    if (satellite) {
      const decision = this.#policy.evaluateRequest(satellite, {});
      if (!decision.allow) {
        return {
          output: this.#refusalContent(decision.reason),
          toolCalls: [],
          usage: null,
        };
      }
    }
    return super.run(input, { context, ...rest });
  }

  async *runStream(input, { context = {}, ...rest } = {}) {
    const satellite = context?.satellite ?? null;
    if (satellite) {
      const decision = this.#policy.evaluateRequest(satellite, {});
      if (!decision.allow) {
        yield { type: 'text-delta', text: this.#refusalContent(decision.reason) };
        yield { type: 'finish', reason: 'policy' };
        return;
      }
    }
    yield* super.runStream(input, { context, ...rest });
  }

  // --- Private helpers ---

  #snapshotMemory(memoryState) {
    if (!memoryState) return null;
    const notes = memoryState.get?.('notes') ?? [];
    const prefs = memoryState.get?.('preferences') ?? {};
    const hasContent = (Array.isArray(notes) && notes.length > 0) || Object.keys(prefs).length > 0;
    if (!hasContent) return null;
    return { notes_recent: notes.slice(-5), preferences: prefs };
  }

  #refusalContent(reason) {
    const tail = reason ? ` — ${reason}` : '';
    return `I can't do that right now${tail}.`;
  }
}

export default ConciergeAgent;
