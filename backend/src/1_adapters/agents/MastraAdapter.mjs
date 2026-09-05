// backend/src/2_adapters/agents/MastraAdapter.mjs

/**
 * MastraAdapter - Implements IAgentRuntime using Mastra framework
 *
 * SDK details stay inside agent adapters.
 * All agent definitions use the abstract IAgentRuntime interface.
 */

import { Agent } from '@mastra/core/agent';
import { createTool as mastraCreateTool } from '@mastra/core/tools';
import { RequestContext, MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { MastraLogger } from '@mastra/core/logger';
import { createLogger } from '#system/logging/logger.mjs';
import { standardSchema, assertSchema } from './standardSchema.mjs';
import crypto from 'node:crypto';
import { IAgentRuntime } from '#apps/agents/ports/IAgentRuntime.mjs';

class StructuredSdkLogger extends MastraLogger {
  constructor(logger) { super({ name: 'daylight-agent' }); this.sink = logger; }
  debug(message) { this.sink.debug?.('agent.sdk', { message }); }
  info(message) { this.sink.info?.('agent.sdk', { message }); }
  warn(message) { this.sink.warn?.('agent.sdk', { message }); }
  error(message) { this.sink.error?.('agent.sdk', { message }); }
}

export class MastraAdapter extends IAgentRuntime {
  #model;
  #logger;
  #maxToolCalls;
  #timeoutMs;
  #AgentClass;
  #memory;
  #inputProcessors;
  #outputProcessors;
  #executionPolicy;
  #hooks;

  /**
   * @param {Object} deps
   * @param {string} [deps.model='openai/gpt-4o'] - Model identifier (provider/model format)
   * @param {Object} [deps.logger] - Logger instance
   * @param {number} [deps.maxToolCalls=50] - Maximum tool calls before aborting
   * @param {number} [deps.timeoutMs=120000] - Execution timeout in ms
   * @param {Object} deps.executionPolicy - Application-owned turn/tool policy
   * @param {Function} [deps.agentClass] - Agent class to instantiate (defaults to @mastra/core Agent; injectable for tests)
   * @param {import('@mastra/memory').Memory|null} [deps.memory] - Mastra Memory instance for cross-session persistence
   * @param {Array|null} [deps.inputProcessors] - Mastra input processors (e.g. ObservationalMemory)
   * @param {Array|null} [deps.outputProcessors] - Mastra output processors (e.g. ObservationalMemory)
   */
  constructor(deps = {}) {
    super();
    if (!deps.executionPolicy?.createTranscript || !deps.executionPolicy?.decorateTools
      || !deps.executionPolicy?.isLimitReached) {
      throw new Error('MastraAdapter requires executionPolicy');
    }
    this.#model = deps.model || 'openai/gpt-4o';
    this.#logger = deps.logger || createLogger({ app: 'agents' });
    this.#maxToolCalls = deps.maxToolCalls || 50;
    this.#timeoutMs = deps.timeoutMs || 120000;
    this.#AgentClass = deps.agentClass || Agent;
    this.#memory = deps.memory || null;
    this.#inputProcessors = deps.inputProcessors || null;
    this.#outputProcessors = deps.outputProcessors || null;
    this.#executionPolicy = deps.executionPolicy;
    this.#hooks = deps.hooks || {};
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
   * Mastra-specific wiring (Standard Schema + mastraCreateTool) and
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
    const decoratorContext = { ...context, transcript };
    const decorated = this.#executionPolicy.decorateTools({ tools, context, transcript, agent });

    const mastraTools = {};
    for (let i = 0; i < decorated.length; i++) {
      const decoratedTool = decorated[i];
      const originalTool = tools[i];

      // Use the already-stripped schema from the decorated tool (UserIdInjector
      // ran stripUserIdFromSchema on it).
      mastraTools[originalTool.name] = mastraCreateTool({
        id: originalTool.name,
        description: originalTool.description,
        inputSchema: standardSchema(decoratedTool.parameters),
        ...(originalTool.outputSchema ? { outputSchema: standardSchema(originalTool.outputSchema) } : {}),
        ...(originalTool.suspendSchema ? { suspendSchema: standardSchema(originalTool.suspendSchema) } : {}),
        ...(originalTool.resumeSchema ? { resumeSchema: standardSchema(originalTool.resumeSchema) } : {}),
        ...(originalTool.requireApproval ? { requireApproval: true } : {}),
        ...(originalTool.toModelOutput ? { toModelOutput: originalTool.toModelOutput } : {}),
        ...(originalTool.transform ? { transform: originalTool.transform } : {}),
        execute: async (inputData, sdkContext) => {
          context.signal?.throwIfAborted();
          assertSchema(inputData ?? {}, decoratedTool.parameters, originalTool.name);
          callCounter.count++;

          this.#logger.debug?.('tool.execute.call', {
            tool: originalTool.name,
            turnId: transcript?.turnId,
            callNumber: callCounter.count,
            maxCalls: this.#maxToolCalls,
          });

          // decoratedTool.execute handles: userId injection, call limiting,
          // transcript recording, and error-envelope wrapping on throws.
          const result = await decoratedTool.execute(inputData ?? {}, {
            ...decoratorContext,
            signal: context.signal ?? sdkContext?.abortSignal,
            toolCallId: sdkContext?.toolCallId,
            resumeData: sdkContext?.agent?.resumeData,
            requestInput: sdkContext?.agent?.suspend,
          });
          context.signal?.throwIfAborted();
          if (!result?.error) assertSchema(result, originalTool.outputSchema, originalTool.name + ' output');
          await this.#emitHook('onToolResult', { tool: originalTool.name, toolCallId: sdkContext?.toolCallId,
            runId: context.runId, userId: context.userId, result });

          if (result && typeof result === 'object' && 'error' in result) {
            // Distinguish limit-reached from other errors for the warn log.
            if (this.#executionPolicy.isLimitReached(result)) {
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
  async execute({ agent, agentId, input, messages = [], tools, systemPrompt, context = {}, ...options }) {
    const scope = this.#executionScope(options, context);
    context = scope.context;
    tools = this.#allowedTools(tools, options.toolAllowlist);
    const name = agentId || agent?.constructor?.id || 'unknown';
    const turnId = context.turnId ?? crypto.randomUUID();
    const userId = context.userId ?? null;
    const threadId = context.threadId ?? null;

    const transcript = this.#executionPolicy.createTranscript({
      agentId: name,
      userId,
      turnId,
      input,
      context,
      systemPrompt,
      model: parseModelDescriptor(this.#model),
    });

    const callCounter = { count: 0 };

    const startedAt = Date.now();
    this.#logger.info?.('agent.execute.start', {
      agentId: name,
      turnId,
      userId,
    });

    try {
      scope.context.signal.throwIfAborted();
      const mastraTools = this.#translateTools(tools || [], context, callCounter, transcript, agent);
      const agentOpts = {
        id: name,
        name,
        instructions: systemPrompt,
        model: this.#model,
        tools: mastraTools,
        // Workaround for Mastra issue #16179 — autoResumeSuspendedTools
        // mutates schemas across Zod v3/v4 and crashes prepare-tools-step.
        autoResumeSuspendedTools: false,
        defaultOptions: { autoResumeSuspendedTools: false },
        ...(this.#inputProcessors ? { inputProcessors: this.#inputProcessors } : {}),
        ...(this.#outputProcessors ? { outputProcessors: this.#outputProcessors } : {}),
      };
      if (this.#memory) agentOpts.memory = this.#memory;
      const mastraAgent = new this.#AgentClass(agentOpts);
      mastraAgent.__setLogger?.(new StructuredSdkLogger(this.#logger));

      const callArg = (Array.isArray(messages) && messages.length > 0) ? messages : input;

      const memoryOpts = (this.#memory && userId && threadId)
        ? { memory: { resource: userId, thread: threadId } }
        : null;


      const response = await scope.wait(mastraAgent.generate(callArg, {
        ...memoryOpts, ...scope.options,
        ...(options.outputSchema ? { structuredOutput: {
          schema: standardSchema(options.outputSchema), errorStrategy: 'strict',
        } } : {}),
      }));
      if (response.error) throw response.error;
      if (response.tripwire) throw Object.assign(new Error('Agent input was blocked by a processor'), { code: 'AGENT_INPUT_BLOCKED' });
      const suspended = response.finishReason === 'suspended' || response.suspendPayload != null;
      if (options.outputSchema && !suspended) {
        assertSchema(response.object, options.outputSchema, 'agent output');
      }

      transcript?.setOutput({
        text: response.text || '',
        finishReason: response.finishReason || (response.toolCalls?.length ? 'tool_calls' : 'stop'),
        usage: response.usage || null,
      });
      transcript?.setStatus(suspended ? 'suspended' : 'ok');

      this.#logger.info?.('agent.execute.complete', {
        agentId: name,
        turnId,
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });

      const result = {
        output: response.text,
        toolCalls: response.toolCalls || [],
        turnId,
        runId: response.runId ?? context.runId ?? turnId,
        status: suspended ? 'suspended' : 'completed',
        structured: response.object,
        usage: response.totalUsage ?? response.usage ?? null,
        finishReason: response.finishReason,
        ...(response.suspendPayload ? { interaction: response.suspendPayload } : {}),
      };
      const evaluation = await scope.wait(this.#emitHook('evaluate', { ...result, agentId: name, userId }));
      if (evaluation !== undefined) result.evaluation = evaluation;
      await this.#emitHook('onResult', { ...result, agentId: name, userId });
      return result;
    } catch (error) {
      transcript?.setError(error, { toolCallsBeforeError: callCounter.count });
      transcript?.setStatus(error?.name === 'AbortError' ? 'aborted' : error?.name === 'TimeoutError' ? 'timeout' : 'error');
      await this.#emitHook('onError', { agentId: name, userId, turnId, error });

      this.#logger.error?.('agent.execute.error', {
        agentId: name,
        turnId,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      scope.close();
      try { await transcript?.flush(); } catch { /* swallow */ }
    }
  }

  /**
   * Execute an agent with streaming output.
   * Yields normalized chunks: text-delta, tool-start, tool-end, finish.
   * @implements IAgentRuntime.streamExecute
   */
  async *streamExecute({ agent, agentId, input, messages = [], tools, systemPrompt, context = {}, ...options }) {
    const scope = this.#executionScope(options, context);
    context = scope.context;
    tools = this.#allowedTools(tools, options.toolAllowlist);
    const name = agentId || agent?.constructor?.id || 'unknown';
    const turnId = context.turnId ?? crypto.randomUUID();
    const userId = context.userId ?? null;
    const threadId = context.threadId ?? null;

    const transcript = this.#executionPolicy.createTranscript({
      agentId: name,
      userId,
      turnId,
      input,
      context,
      systemPrompt,
      model: parseModelDescriptor(this.#model),
    });

    const callCounter = { count: 0 };

    const startedAt = Date.now();
    this.#logger.info?.('agent.stream.start', {
      agentId: name,
      turnId,
      userId,
    });

    let accumulatedText = '';
    let finishReason = 'stop';
    let usage = null;
    const toolStartTimes = new Map();
    let iterator;

    try {
      scope.context.signal.throwIfAborted();
      const mastraTools = this.#translateTools(tools || [], context, callCounter, transcript, agent);
      const agentOpts = {
        id: name,
        name,
        instructions: systemPrompt,
        model: this.#model,
        tools: mastraTools,
        // Workaround for Mastra issue #16179 — autoResumeSuspendedTools
        // mutates schemas across Zod v3/v4 and crashes prepare-tools-step.
        autoResumeSuspendedTools: false,
        defaultOptions: { autoResumeSuspendedTools: false },
        ...(this.#inputProcessors ? { inputProcessors: this.#inputProcessors } : {}),
        ...(this.#outputProcessors ? { outputProcessors: this.#outputProcessors } : {}),
      };
      if (this.#memory) agentOpts.memory = this.#memory;
      const mastraAgent = new this.#AgentClass(agentOpts);
      mastraAgent.__setLogger?.(new StructuredSdkLogger(this.#logger));

      const callArg = (Array.isArray(messages) && messages.length > 0) ? messages : input;
      const memoryOpts = (this.#memory && userId && threadId)
        ? { memory: { resource: userId, thread: threadId } }
        : null;
      const output = await scope.wait(mastraAgent.stream(callArg, { ...memoryOpts, ...scope.options }));
      const iterable = output?.fullStream ?? output;
      iterator = iterable[Symbol.asyncIterator]();
      while (true) {
        const next = await scope.wait(iterator.next());
        if (next.done) break;
        const part = next.value;
        scope.context.signal.throwIfAborted();
        const payload = part?.payload ?? {};
        switch (part?.type) {
          case 'text-delta': {
            const text = payload.text ?? part.textDelta ?? part.text ?? '';
            accumulatedText += text;
            yield { type: 'text-delta', text };
            break;
          }
          case 'tool-call': {
            const toolName = payload.toolName ?? part.toolName;
            const toolCallId = payload.toolCallId ?? part.toolCallId ?? toolName;
            toolStartTimes.set(toolCallId, Date.now());
            yield { type: 'tool-start', toolName, toolCallId, args: payload.args ?? part.args };
            break;
          }
          case 'tool-result': {
            const toolName = payload.toolName ?? part.toolName;
            const toolCallId = payload.toolCallId ?? part.toolCallId ?? toolName;
            const toolStartedAt = toolStartTimes.get(toolCallId);
            const latencyMs = toolStartedAt ? Date.now() - toolStartedAt : 0;
            toolStartTimes.delete(toolCallId);
            yield { type: 'tool-end', toolName, toolCallId, result: payload.result ?? part.result, latencyMs };
            break;
          }
          case 'finish':
            finishReason = payload?.stepResult?.reason ?? part.finishReason ?? 'stop';
            usage = payload?.output?.usage ?? part.usage ?? null;
            yield { type: 'finish', reason: finishReason, usage };
            break;
          case 'tool-call-approval':
          case 'tool-call-suspended':
            yield { type: 'input-required', runId: part.runId ?? output.runId, interaction: payload };
            break;
          case 'abort':
            throw new DOMException('Agent execution aborted', 'AbortError');
          case 'error':
          case 'tool-error':
            yield { type: 'error', message: String(payload.error?.message ?? payload.error ?? 'Agent execution failed'), toolCallId: payload.toolCallId };
            break;
          default:
            this.#logger.debug?.('agent.stream.unknown_event', {
              type: part?.type,
              turnId,
            });
        }
      }

      transcript?.setOutput({ text: accumulatedText, finishReason, usage });
      transcript?.setStatus('ok');
      await this.#emitHook('onResult', { agentId: name, userId, turnId, output: accumulatedText, finishReason, usage });

      this.#logger.info?.('agent.stream.complete', {
        agentId: name,
        turnId,
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      transcript?.setError(error, { toolCallsBeforeError: callCounter.count });
      transcript?.setStatus(error?.name === 'AbortError' ? 'aborted' : error?.name === 'TimeoutError' ? 'timeout' : 'error');
      await this.#emitHook('onError', { agentId: name, userId, turnId, error });

      this.#logger.error?.('agent.stream.error', {
        agentId: name,
        turnId,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      scope.close();
      // Do not let a stalled provider's iterator.return() hold cancellation open.
      try { Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* scope already closed */ }
      try { await transcript?.flush(); } catch { /* swallow */ }
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

  #allowedTools(tools = [], allowlist) {
    if (!allowlist) return tools;
    const allowed = new Set(allowlist);
    return tools.filter(tool => allowed.has(tool.name));
  }

  #executionScope(options, context) {
    const controller = new AbortController();
    const timeoutMs = options.limits?.timeoutMs ?? this.#timeoutMs;
    const external = options.signal ?? context.signal;
    const abort = () => controller.abort(external.reason);
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new DOMException(
      `Agent execution timed out after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
    timer.unref?.();
    const signal = controller.signal;
    const requestContext = new RequestContext(Object.entries(context).filter(([key]) => !['signal', 'requestContext'].includes(key) && !key.startsWith('mastra__')));
    if (context.userId) requestContext.set(MASTRA_RESOURCE_ID_KEY, context.userId);
    if (context.threadId) requestContext.set(MASTRA_THREAD_ID_KEY, context.threadId);
    return {
      context: { ...context, signal, maxToolCalls: options.limits?.maxToolCalls ?? this.#maxToolCalls },
      options: {
        abortSignal: signal,
        requestContext,
        maxSteps: options.limits?.maxSteps ?? options.limits?.maxToolCalls ?? this.#maxToolCalls,
        timeout: { totalMs: timeoutMs },
        ...(context.runId ? { runId: context.runId } : {}),
        ...(options.modelSettings ? { modelSettings: options.modelSettings } : {}),
      },
      async wait(promise) {
        signal.throwIfAborted();
        let rejectOnAbort;
        const aborted = new Promise((_, reject) => {
          rejectOnAbort = () => reject(signal.reason);
          signal.addEventListener('abort', rejectOnAbort, { once: true });
        });
        try { return await Promise.race([promise, aborted]); }
        finally { signal.removeEventListener('abort', rejectOnAbort); }
      },
      close() {
        clearTimeout(timer);
        external?.removeEventListener('abort', abort);
        controller.abort(new DOMException('Execution scope closed', 'AbortError'));
      },
    };
  }

  async #emitHook(name, value) {
    if (!this.#hooks[name]) return undefined;
    let timer;
    try { return await Promise.race([Promise.resolve().then(() => this.#hooks[name](value)), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Hook deadline exceeded')), 1000); timer.unref?.();
    })]); }
    catch (error) { this.#logger.warn?.('agent.hook.failed', { name, error: error.message }); }
    finally { clearTimeout(timer); }
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
