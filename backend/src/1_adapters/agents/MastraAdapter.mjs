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
import crypto from 'node:crypto';
import { AgentTranscript } from '#apps/agents/framework/AgentTranscript.mjs';

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
  #mediaDir;

  /**
   * @param {Object} deps
   * @param {string} [deps.model='openai/gpt-4o'] - Model identifier (provider/model format)
   * @param {Object} [deps.logger] - Logger instance
   * @param {number} [deps.maxToolCalls=50] - Maximum tool calls before aborting
   * @param {number} [deps.timeoutMs=120000] - Execution timeout in ms
   * @param {string} [deps.mediaDir] - Base media directory; transcripts written under {mediaDir}/logs/agents/...
   */
  constructor(deps = {}) {
    this.#model = deps.model || 'openai/gpt-4o';
    this.#logger = deps.logger || console;
    this.#maxToolCalls = deps.maxToolCalls || 50;
    this.#timeoutMs = deps.timeoutMs || 120000;
    this.#mediaDir = deps.mediaDir || null;
  }

  /**
   * Translate ITool[] to Mastra tool format
   * @param {Array} tools - ITool instances
   * @param {Object} context - Execution context
   * @param {Object} callCounter - Mutable counter object
   * @param {AgentTranscript|null} transcript - Optional transcript for recording tool calls
   * @returns {Object} Mastra tools object
   */
  #translateTools(tools, context, callCounter, transcript = null) {
    const mastraTools = {};

    for (const tool of tools) {
      mastraTools[tool.name] = mastraCreateTool({
        id: tool.name,
        description: tool.description,
        inputSchema: jsonSchemaToZod(tool.parameters),
        execute: async (inputData) => {
          callCounter.count++;
          this.#logger.debug?.('tool.execute.call', {       // ← was info, now debug
            tool: tool.name,
            turnId: transcript?.turnId,
            callNumber: callCounter.count,
            maxCalls: this.#maxToolCalls,
          });

          if (callCounter.count > this.#maxToolCalls) {
            const msg = `Tool call limit reached (${this.#maxToolCalls}). Aborting to prevent runaway costs.`;
            this.#logger.warn?.('tool.execute.limit_reached', {
              tool: tool.name,
              turnId: transcript?.turnId,
              count: callCounter.count,
            });
            transcript?.recordTool({
              name: tool.name,
              args: inputData,
              result: { error: msg },
              ok: false,
              latencyMs: 0,
            });
            return { error: msg };
          }

          const startedAt = Date.now();
          try {
            const result = await tool.execute(inputData, context);
            const latencyMs = Date.now() - startedAt;
            transcript?.recordTool({
              name: tool.name,
              args: inputData,
              result,
              ok: !(result && typeof result === 'object' && 'error' in result),
              latencyMs,
            });
            return result;
          } catch (error) {
            const latencyMs = Date.now() - startedAt;
            this.#logger.error?.('tool.execute.error', {
              tool: tool.name,
              turnId: transcript?.turnId,
              error: error.message,
            });
            transcript?.recordTool({
              name: tool.name,
              args: inputData,
              result: { error: error.message },
              ok: false,
              latencyMs,
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
    const turnId = context.turnId ?? crypto.randomUUID();
    const userId = context.userId ?? null;

    const transcript = new AgentTranscript({
      agentId: name,
      userId,
      turnId,
      input: { text: input, context: { ...context, turnId } },
      mediaDir: this.#mediaDir,
      logger: this.#logger,
    });
    transcript.setSystemPrompt(systemPrompt);
    transcript.setModel(parseModelDescriptor(this.#model));

    const callCounter = { count: 0 };
    const mastraTools = this.#translateTools(tools || [], context, callCounter, transcript);

    const startedAt = Date.now();
    this.#logger.info?.('agent.execute.start', {
      agentId: name,
      turnId,
      userId,
    });

    try {
      const mastraAgent = new Agent({
        name,
        instructions: systemPrompt,
        model: this.#model,
        tools: mastraTools,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Agent execution timed out after ${this.#timeoutMs}ms`)), this.#timeoutMs)
      );
      const response = await Promise.race([
        mastraAgent.generate(input),
        timeoutPromise,
      ]);

      transcript.setOutput({
        text: response.text || '',
        finishReason: response.finishReason || (response.toolCalls?.length ? 'tool_calls' : 'stop'),
        usage: response.usage || null,
      });
      transcript.setStatus('ok');

      this.#logger.info?.('agent.execute.complete', {
        agentId: name,
        turnId,
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });

      return {
        output: response.text,
        toolCalls: response.toolCalls || [],
        turnId,
      };
    } catch (error) {
      transcript.setError(error, { toolCallsBeforeError: callCounter.count });
      transcript.setStatus(error?.name === 'AbortError' ? 'aborted' : 'error');

      this.#logger.error?.('agent.execute.error', {
        agentId: name,
        turnId,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      try { await transcript.flush(); } catch { /* swallow */ }
    }
  }

  /**
   * Execute an agent with streaming output.
   * Yields normalized chunks: text-delta, tool-start, tool-end, finish.
   * @implements IAgentRuntime.streamExecute
   */
  async *streamExecute({ agent, agentId, input, tools, systemPrompt, context = {} }) {
    const name = agentId || agent?.constructor?.id || 'unknown';
    const callCounter = { count: 0 };
    const mastraTools = this.#translateTools(tools || [], context, callCounter);

    const mastraAgent = new Agent({
      name,
      instructions: systemPrompt,
      model: this.#model,
      tools: mastraTools,
    });

    this.#logger.info?.('agent.stream.start', {
      agentId: name,
      inputLength: input?.length,
      toolCount: Object.keys(mastraTools).length,
    });

    const start = Date.now();
    let totalChunks = 0;
    try {
      const output = await mastraAgent.stream(input);
      const iterable = output?.fullStream ?? output;
      for await (const part of iterable) {
        totalChunks++;
        const payload = part?.payload ?? {};
        switch (part?.type) {
          case 'text-delta':
            yield { type: 'text-delta', text: payload.text ?? part.textDelta ?? part.text ?? '' };
            break;
          case 'tool-call':
            yield { type: 'tool-start', toolName: payload.toolName ?? part.toolName, args: payload.args ?? part.args };
            break;
          case 'tool-result':
            yield { type: 'tool-end', toolName: payload.toolName ?? part.toolName, result: payload.result ?? part.result };
            break;
          case 'finish':
            yield {
              type: 'finish',
              reason: payload?.stepResult?.reason ?? part.finishReason ?? 'stop',
              usage: payload?.output?.usage ?? part.usage,
            };
            break;
          default:
            this.#logger.debug?.('agent.stream.unknown_event', { type: part?.type });
        }
      }
      this.#logger.info?.('agent.stream.complete', {
        agentId: name,
        totalChunks,
        latencyMs: Date.now() - start,
        toolCallsUsed: callCounter.count,
      });
    } catch (error) {
      this.#logger.error?.('agent.stream.error', {
        agentId: name,
        error: error.message,
        latencyMs: Date.now() - start,
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

/**
 * Parse a model string or object into { name, provider } descriptor.
 * @param {string|object} model
 * @returns {{ name: string, provider: string }}
 */
function parseModelDescriptor(model) {
  if (!model) return { name: 'unknown', provider: 'unknown' };
  if (typeof model === 'string') {
    // 'openai/gpt-4o' → { provider: 'openai', name: 'gpt-4o' }
    const idx = model.indexOf('/');
    if (idx > 0) {
      return { provider: model.slice(0, idx), name: model.slice(idx + 1) };
    }
    return { provider: 'unknown', name: model };
  }
  // Object form: { modelId, provider } or similar
  return {
    name: model.modelId || model.name || 'unknown',
    provider: model.provider || 'unknown',
  };
}

export default MastraAdapter;
