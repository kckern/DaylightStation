// backend/src/2_adapters/agents/MastraAdapter.mjs

/**
 * MastraAdapter - Implements IAgentRuntime using Mastra framework
 *
 * This is the ONLY file that imports the Mastra SDK.
 * All agent definitions use the abstract IAgentRuntime interface.
 */

import { Agent } from '@mastra/core/agent';
import { createTool as mastraCreateTool } from '@mastra/core/tools';
import { z } from 'zod';
import crypto from 'crypto';

/**
 * Convert JSON Schema to Zod schema (simplified)
 * @param {Object} jsonSchema
 * @returns {z.ZodType}
 */
function jsonSchemaToZod(jsonSchema) {
  if (!jsonSchema || jsonSchema.type !== 'object') {
    return z.object({});
  }

  const shape = {};
  const properties = jsonSchema.properties || {};
  const required = jsonSchema.required || [];

  for (const [key, prop] of Object.entries(properties)) {
    let zodType;

    switch (prop.type) {
      case 'string':
        zodType = z.string();
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      case 'number':
      case 'integer':
        zodType = z.number();
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      case 'boolean':
        zodType = z.boolean();
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      case 'array':
        zodType = z.array(z.any());
        if (prop.description) zodType = zodType.describe(prop.description);
        break;
      default:
        zodType = z.any();
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

export class MastraAdapter {
  #model;
  #logger;
  #maxToolCalls;
  #timeoutMs;

  /**
   * @param {Object} deps
   * @param {string} [deps.model='openai/gpt-4o'] - Model identifier (provider/model format)
   * @param {Object} [deps.logger] - Logger instance
   * @param {number} [deps.maxToolCalls=50] - Maximum tool calls before aborting
   * @param {number} [deps.timeoutMs=120000] - Execution timeout in ms
   */
  constructor(deps = {}) {
    this.#model = deps.model || 'openai/gpt-4o';
    this.#logger = deps.logger || console;
    this.#maxToolCalls = deps.maxToolCalls || 50;
    this.#timeoutMs = deps.timeoutMs || 120000;
  }

  /**
   * Translate ITool[] to Mastra tool format
   * @param {Array} tools - ITool instances
   * @param {Object} context - Execution context
   * @returns {Object} Mastra tools object
   */
  #translateTools(tools, context, callCounter) {
    const mastraTools = {};

    for (const tool of tools) {
      mastraTools[tool.name] = mastraCreateTool({
        id: tool.name,
        description: tool.description,
        inputSchema: jsonSchemaToZod(tool.parameters),
        execute: async (inputData) => {
          callCounter.count++;
          this.#logger.info?.('tool.execute.call', {
            tool: tool.name,
            callNumber: callCounter.count,
            maxCalls: this.#maxToolCalls,
          });

          if (callCounter.count > this.#maxToolCalls) {
            const msg = `Tool call limit reached (${this.#maxToolCalls}). Aborting to prevent runaway costs.`;
            this.#logger.warn?.('tool.execute.limit_reached', { tool: tool.name, count: callCounter.count });
            return { error: msg };
          }

          try {
            const result = await tool.execute(inputData, context);
            return result;
          } catch (error) {
            this.#logger.error?.('tool.execute.error', {
              tool: tool.name,
              error: error.message,
            });
            return { error: error.message };
          }
        },
      });
    }

    return mastraTools;
  }

  /**
   * Execute an agent synchronously
   * @implements IAgentRuntime.execute
   */
  async execute({ agent, agentId, input, tools, systemPrompt, context = {} }) {
    const name = agentId || agent?.constructor?.id || 'unknown';
    const callCounter = { count: 0 };
    const mastraTools = this.#translateTools(tools || [], context, callCounter);

    const mastraAgent = new Agent({
      name,
      instructions: systemPrompt,
      model: this.#model,
      tools: mastraTools,
    });

    this.#logger.info?.('agent.execute.start', {
      agentId: name,
      inputLength: input?.length,
      toolCount: Object.keys(mastraTools).length,
      maxToolCalls: this.#maxToolCalls,
      timeoutMs: this.#timeoutMs,
    });

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Agent execution timed out after ${this.#timeoutMs}ms`)), this.#timeoutMs)
      );
      const response = await Promise.race([
        mastraAgent.generate(input),
        timeoutPromise,
      ]);

      this.#logger.info?.('agent.execute.complete', {
        agentId: name,
        outputLength: response.text?.length,
        toolCallsUsed: callCounter.count,
      });

      return {
        output: response.text,
        toolCalls: response.toolCalls || [],
      };
    } catch (error) {
      this.#logger.error?.('agent.execute.error', {
        agentId: name,
        error: error.message,
        toolCallsUsed: callCounter.count,
      });
      throw error;
    }
  }

  /**
   * Execute an agent in background
   * @implements IAgentRuntime.executeInBackground
   */
  async executeInBackground(options, onComplete) {
    const taskId = crypto.randomUUID();

    this.#logger.info?.('agent.background.start', {
      taskId,
      agentId: options.agent?.constructor?.id,
    });

    setImmediate(async () => {
      try {
        const result = await this.execute(options);
        this.#logger.info?.('agent.background.complete', { taskId });
        onComplete?.(result);
      } catch (error) {
        this.#logger.error?.('agent.background.error', {
          taskId,
          error: error.message,
        });
        onComplete?.({ error: error.message });
      }
    });

    return { taskId };
  }
}

export default MastraAdapter;
