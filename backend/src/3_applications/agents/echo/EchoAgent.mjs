// backend/src/3_applications/agents/echo/EchoAgent.mjs

/**
 * EchoAgent - Diagnostic echo agent
 *
 * Extends BaseAgent but overrides run() and runStream() to skip the LLM
 * round-trip. Its purpose is to validate orchestrator + transcript + memory
 * plumbing without any external dependencies (no Anthropic API call needed).
 *
 * Tools and memory lifecycle: EchoAgent registers no tools (diagnostic use only)
 * and skips memory I/O — it never needed memory and adding it would change
 * behavior without value. Memory load/save is intentionally omitted.
 */

import { BaseAgent } from '../framework/BaseAgent.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class EchoAgent extends BaseAgent {
  static id = 'echo';
  static description = 'Diagnostic echo agent — returns its input verbatim, no LLM round-trip';

  #timestampFn;

  /**
   * @param {Object} deps
   * @param {Object} deps.agentRuntime - IAgentRuntime implementation (required by BaseAgent)
   * @param {Object} deps.workingMemory - IWorkingMemory implementation (required by BaseAgent)
   * @param {Function} [deps.timestampFn] - Function returning current timestamp string
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps) {
    super(deps);
    this.#timestampFn = deps.timestampFn || (() => new Date().toISOString());
  }

  /**
   * System prompt — kept for completeness; never sent to an LLM by this agent.
   */
  getSystemPrompt(_context = {}) {
    return systemPrompt;
  }

  /**
   * No tools — diagnostic agent, no LLM round-trip so tools are never called.
   * Overrides BaseAgent no-op to be explicit.
   */
  registerTools() {
    // intentionally empty — EchoAgent registers no tools
  }

  /**
   * Override BaseAgent.run to skip the LLM round-trip.
   * Returns the input verbatim. No memory I/O (diagnostic agent only).
   *
   * @param {string} input - User message
   * @param {Object} [options={}]
   * @param {Object} [options.context] - Execution context
   * @returns {Promise<{output: string, toolCalls: Array, usage: null}>}
   */
  async run(input, { context = {} } = {}) {
    return {
      output: `Echo: ${input}`,
      toolCalls: [],
      usage: null,
    };
  }

  /**
   * Override BaseAgent.runStream to skip the LLM round-trip.
   * Yields a single text-delta chunk and a finish event.
   *
   * @yields {{ type: 'text-delta'|'finish', ... }}
   */
  async *runStream(input, { context = {} } = {}) {
    const output = `Echo: ${input}`;
    yield { type: 'text-delta', text: output };
    yield { type: 'finish', output, toolCalls: [], usage: null };
  }
}

export default EchoAgent;
