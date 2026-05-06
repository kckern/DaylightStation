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
import { applyDecorators } from '../../3_applications/agents/framework/decorators/applyDecorators.mjs';
import { userIdInjector } from '../../3_applications/agents/framework/decorators/UserIdInjector.mjs';
import { createCallLimiter, LIMIT_REACHED_MESSAGE_PREFIX } from '../../3_applications/agents/framework/decorators/CallLimiter.mjs';
import { transcriptRecorder } from '../../3_applications/agents/framework/decorators/TranscriptRecorder.mjs';

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
   * Translate ITool[] to Mastra tool format via the decorator chain.
   *
   * Decorators applied left-to-right (outermost first):
   *   [agent.buildToolDecorators()...] → userIdInjector → callLimiter → transcriptRecorder
   *
   * The agent's own decorators (e.g. PolicyDecorator on concierge) are
   * prepended so they run before the framework defaults.
   *
   * Mastra-specific wiring (jsonSchemaToZod + mastraCreateTool) and
   * structured logger emission stay at adapter level.
   *
   * @param {Array} tools - ITool instances
   * @param {Object} context - Execution context (includes userId)
   * @param {Object} callCounter - Mutable counter object (for toolCallsBeforeError)
   * @param {AgentTranscript|null} transcript - Optional transcript for recording tool calls
   * @param {Object|null} agent - The BaseAgent instance (optional; provides buildToolDecorators)
   * @returns {Object} Mastra tools object
   */
  #translateTools(tools, context, callCounter, transcript = null, agent = null) {
    const callLimiter = createCallLimiter({ maxToolCalls: this.#maxToolCalls });
    const decoratorContext = { ...context, transcript };

    const agentExtraDecorators = (typeof agent?.buildToolDecorators === 'function')
      ? agent.buildToolDecorators()
      : [];

    const decorated = applyDecorators(
      tools,
      [...agentExtraDecorators, userIdInjector, callLimiter, transcriptRecorder],
      decoratorContext,
    );

    const mastraTools = {};
    for (let i = 0; i < decorated.length; i++) {
      const decoratedTool = decorated[i];
      const originalTool = tools[i];

      // Use the already-stripped schema from the decorated tool (UserIdInjector
      // ran stripUserIdFromSchema on it).
      mastraTools[originalTool.name] = mastraCreateTool({
        id: originalTool.name,
        description: originalTool.description,
        inputSchema: jsonSchemaToZod(decoratedTool.parameters),
        execute: async (inputData) => {
          callCounter.count++;

          this.#logger.debug?.('tool.execute.call', {
            tool: originalTool.name,
            turnId: transcript?.turnId,
            callNumber: callCounter.count,
            maxCalls: this.#maxToolCalls,
          });

          // decoratedTool.execute handles: userId injection, call limiting,
          // transcript recording, and error-envelope wrapping on throws.
          const result = await decoratedTool.execute(inputData ?? {}, decoratorContext);

          if (result && typeof result === 'object' && 'error' in result) {
            // Distinguish limit-reached from other errors for the warn log.
            if (typeof result.error === 'string' && result.error.startsWith(LIMIT_REACHED_MESSAGE_PREFIX)) {
              this.#logger.warn?.('tool.execute.limit_reached', {
                tool: originalTool.name,
                turnId: transcript?.turnId,
                count: callCounter.count,
              });
            } else {
              this.#logger.error?.('tool.execute.error', {
                tool: originalTool.name,
                turnId: transcript?.turnId,
                error: result.error,
              });
            }
          } else {
            this.#logger.debug?.('tool.execute.complete', {
              tool: originalTool.name,
              turnId: transcript?.turnId,
            });
          }

          return result;
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
    const mastraTools = this.#translateTools(tools || [], context, callCounter, transcript, agent);

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
    const mastraTools = this.#translateTools(tools || [], context, callCounter, transcript, agent);

    const startedAt = Date.now();
    this.#logger.info?.('agent.stream.start', {
      agentId: name,
      turnId,
      userId,
    });

    let accumulatedText = '';
    let finishReason = 'stop';
    let usage = null;

    try {
      const mastraAgent = new Agent({
        name,
        instructions: systemPrompt,
        model: this.#model,
        tools: mastraTools,
      });

      const output = await mastraAgent.stream(input);
      const iterable = output?.fullStream ?? output;
      for await (const part of iterable) {
        const payload = part?.payload ?? {};
        switch (part?.type) {
          case 'text-delta': {
            const text = payload.text ?? part.textDelta ?? part.text ?? '';
            accumulatedText += text;
            yield { type: 'text-delta', text };
            break;
          }
          case 'tool-call':
            yield { type: 'tool-start', toolName: payload.toolName ?? part.toolName, args: payload.args ?? part.args };
            break;
          case 'tool-result':
            yield { type: 'tool-end', toolName: payload.toolName ?? part.toolName, result: payload.result ?? part.result };
            break;
          case 'finish':
            finishReason = payload?.stepResult?.reason ?? part.finishReason ?? 'stop';
            usage = payload?.output?.usage ?? part.usage ?? null;
            yield { type: 'finish', reason: finishReason, usage };
            break;
          default:
            this.#logger.debug?.('agent.stream.unknown_event', {
              type: part?.type,
              turnId,
            });
        }
      }

      transcript.setOutput({ text: accumulatedText, finishReason, usage });
      transcript.setStatus('ok');

      this.#logger.info?.('agent.stream.complete', {
        agentId: name,
        turnId,
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      transcript.setError(error, { toolCallsBeforeError: callCounter.count });
      transcript.setStatus(error?.name === 'AbortError' ? 'aborted' : 'error');

      this.#logger.error?.('agent.stream.error', {
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
   * Execute an agent in background
   * @implements IAgentRuntime.executeInBackground
   */
  async executeInBackground(options, onComplete) {
    const taskId = crypto.randomUUID();
    const turnId = options.context?.turnId ?? crypto.randomUUID();
    const augmented = { ...options, context: { ...options.context, turnId } };

    this.#logger.info?.('agent.background.start', {
      taskId,
      turnId,
      agentId: options.agentId || options.agent?.constructor?.id,
    });

    setImmediate(async () => {
      try {
        const result = await this.execute(augmented);
        this.#logger.info?.('agent.background.complete', { taskId, turnId });
        onComplete?.(result);
      } catch (error) {
        this.#logger.error?.('agent.background.error', {
          taskId,
          turnId,
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
