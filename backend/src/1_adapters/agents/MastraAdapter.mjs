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

  /**
   * @param {Object} deps
   * @param {string} [deps.model='openai:gpt-4o'] - Model identifier (provider:model format)
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(deps = {}) {
    this.#model = deps.model || 'openai:gpt-4o';
    this.#logger = deps.logger || console;
  }

  /**
   * Translate ITool[] to Mastra tool format
   * @param {Array} tools - ITool instances
   * @param {Object} context - Execution context
   * @returns {Object} Mastra tools object
   */
  #translateTools(tools, context) {
    const mastraTools = {};

    for (const tool of tools) {
      mastraTools[tool.name] = mastraCreateTool({
        id: tool.name,
        description: tool.description,
        inputSchema: jsonSchemaToZod(tool.parameters),
        execute: async (inputData) => {
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
  async execute({ agent, input, tools, systemPrompt, context = {} }) {
    const mastraTools = this.#translateTools(tools || [], context);

    const mastraAgent = new Agent({
      name: agent.constructor.id,
      instructions: systemPrompt,
      model: this.#model,
      tools: mastraTools,
    });

    this.#logger.info?.('agent.execute.start', {
      agentId: agent.constructor.id,
      inputLength: input?.length,
      toolCount: Object.keys(mastraTools).length,
    });

    try {
      const response = await mastraAgent.generate(input);

      this.#logger.info?.('agent.execute.complete', {
        agentId: agent.constructor.id,
        outputLength: response.text?.length,
      });

      return {
        output: response.text,
        toolCalls: response.toolCalls || [],
      };
    } catch (error) {
      this.#logger.error?.('agent.execute.error', {
        agentId: agent.constructor.id,
        error: error.message,
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
