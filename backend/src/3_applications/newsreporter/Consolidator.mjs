import { parseReport } from '#apps/newsreporter/reportSchema.mjs';
import { ApplicationError } from '#apps/common/errors/ApplicationError.mjs';

/**
 * Consolidator (3_applications).
 *
 * Orchestrates the LLM consolidation step: feed gathered items to the agent
 * runtime with a strict JSON-only instruction, then validate the output
 * against the reportSchema published language. Gives the model exactly one
 * corrective retry before failing the run.
 *
 * Pure orchestration — all I/O is via the injected agentRuntime.
 */
const AGENT_ID = 'newsreporter-consolidator';

const JSON_ONLY_INSTRUCTION =
  '\n\nRespond with ONLY a JSON object: { "sections": [...] } matching the allowed ' +
  'section types (heading, lines, table, note). No prose, no code fences.';

const RETRY_CORRECTION =
  '\n\nYour previous output was invalid JSON or did not match the required schema. ' +
  'Return ONLY the JSON object { "sections": [...] }. No prose, no code fences.';

export class Consolidator {
  #agentRuntime;
  #logger;
  #defaultModel;

  /**
   * @param {{ agentRuntime: { execute: Function }, logger?: object, defaultModel?: string }} deps
   */
  constructor({ agentRuntime, logger, defaultModel } = {}) {
    if (!agentRuntime) throw new Error('Consolidator requires an agentRuntime');
    this.#agentRuntime = agentRuntime;
    this.#logger = logger || console;
    this.#defaultModel = defaultModel;
  }

  /**
   * Consolidate gathered items into validated report sections.
   * @param {{ prompt: string, model?: string, items: Array, ctx?: object }} args
   * @returns {Promise<{ sections: Array }>}
   * @throws {ApplicationError} when the model fails validation twice
   */
  async consolidate({ prompt, model, items, ctx = {} }) {
    const systemPrompt = String(prompt || '') + JSON_ONLY_INSTRUCTION;
    const input = JSON.stringify(items ?? []);

    let report = await this.#attempt({ input, systemPrompt, model, ctx });
    if (!report) {
      this.#logger.warn?.('newsreporter.consolidate.parse_retry', {});
      report = await this.#attempt({ input: input + RETRY_CORRECTION, systemPrompt, model, ctx });
    }

    if (!report) {
      throw new ApplicationError('newsreporter consolidator: model output failed validation after one retry', {
        code: 'NEWSREPORTER_CONSOLIDATE_FAILED',
      });
    }

    this.#logger.info?.('newsreporter.consolidate.ok', { sectionCount: report.sections.length });
    return { sections: report.sections };
  }

  /**
   * Run the agent once and try to parse+validate its output.
   * @returns {Promise<{ sections: Array } | null>} validated report, or null on failure
   */
  async #attempt({ input, systemPrompt, model, ctx }) {
    const result = await this.#agentRuntime.execute({
      agentId: AGENT_ID,
      input,
      systemPrompt,
      model: model || this.#defaultModel,
      tools: [],
      context: { ...ctx },
    });
    try {
      const cleaned = stripCodeFences(result?.output ?? '');
      return parseReport(JSON.parse(cleaned));
    } catch {
      return null;
    }
  }
}

/**
 * Strip a leading/trailing markdown code fence (```...```), with optional
 * language tag, returning the inner text.
 * @param {string} text
 * @returns {string}
 */
function stripCodeFences(text) {
  const trimmed = String(text).trim();
  const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\s*\n?([\s\S]*?)\n?```$/);
  return fence ? fence[1].trim() : trimmed;
}
