// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { MastraAdapter } from '#adapters/agents/MastraAdapter.mjs';
import { MastraRunAdapter } from '#adapters/agents/MastraRunAdapter.mjs';
import { standardSchema } from '#adapters/agents/standardSchema.mjs';
import { createTool } from '#apps/agents/ports/ITool.mjs';
import { buildMastraMemory } from '#adapters/agents/MastraAgentMemoryFactory.mjs';
import { AgentExecutionPolicy } from '#apps/agents/framework/AgentExecutionPolicy.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const logger = { info() {}, debug() {}, warn() {}, error() {} };
const adapter = deps => new MastraAdapter({ logger, executionPolicy: new AgentExecutionPolicy({ logger }), ...deps });
const model = text => ({
  specificationVersion: 'v2', provider: 'test', modelId: 'fixture', supportedUrls: {},
  doGenerate: async () => ({ content: [{ type: 'text', text }], finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] }),
});
describe('Modern Mastra contracts', () => {
  it('keeps concurrent workflow results separate when their run IDs match', async () => {
    const runtime = new MastraRunAdapter({ dbPath: ':memory:' });
    let release;
    let entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    runtime.register({ id: 'first', execute: async () => { entered(); await gate; return { workflow: 'first' }; } });
    runtime.register({ id: 'second', execute: async () => ({ workflow: 'second' }) });
    const first = runtime.start({ workflowId: 'first', userId: 'alice', runId: 'same', input: {} });
    await waiting;
    try {
      const second = await runtime.start({ workflowId: 'second', userId: 'alice', runId: 'same', input: {} });
      expect(second.result).toEqual({ workflow: 'second' });
    } finally { release(); }
    expect((await first).result).toEqual({ workflow: 'first' });
  });
  it('bounds a stalled stream and never starts a pre-cancelled model', async () => {
    const generate = vi.fn(); const returned = vi.fn();
    class FakeAgent {
      generate = generate;
      stream() { return { fullStream: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: returned }) } }; }
    }
    const runtime = adapter({ agentClass: FakeAgent });
    const controller = new AbortController(); controller.abort();
    await expect(runtime.execute({ input: 'hi', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).not.toHaveBeenCalled();
    const consume = async () => { for await (const _chunk of runtime.streamExecute({ input: 'hi', limits: { timeoutMs: 15 } })) { /* empty */ } };
    await expect(consume()).rejects.toMatchObject({ name: 'TimeoutError' }); expect(returned).toHaveBeenCalledOnce();
  });
  it('runs real SDK tools, validates results, and exposes evaluation hooks', async () => {
    let calls = 0;
    const fake = { ...model('done'), doGenerate: async () => (++calls === 1 ? {
      content: [{ type: 'tool-call', toolCallId: 'call1', toolName: 'echo', input: '{"n":2}' }], finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1 }, warnings: [],
    } : model('done').doGenerate()) };
    const execute = vi.fn(async ({ n, userId }, context) => { expect(userId).toBe('alice'); expect(context.toolCallId).toBe('call1'); return { n }; });
    const onToolResult = vi.fn();
    const runtime = adapter({ model: fake, hooks: { onToolResult, evaluate: () => ({ valid: true }) } });
    const result = await runtime.execute({ agentId: 'tool-fixture', input: 'echo', context: { userId: 'alice' }, tools: [createTool({
      name: 'echo', description: 'echo integer', parameters: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } }, additionalProperties: false },
      outputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } }, execute,
    })] });
    expect(result.output).toBe('done'); expect(result.evaluation).toEqual({ valid: true });
    expect(execute).toHaveBeenCalledOnce(); expect(onToolResult).toHaveBeenCalledOnce();
  });
  it('executes processors and maintains real SDK conversation memory', async () => {
    const inputProcessor = { id: 'input', processInput: vi.fn(async ({ messages }) => messages) };
    const memory = buildMastraMemory({ dbPath: ':memory:' });
    const runtime = adapter({ model: model('hello'), memory, inputProcessors: [inputProcessor] });
    await runtime.execute({ agentId: 'remember', input: 'First message', tools: [], context: { userId: 'alice', threadId: 'thread-a' } });
    await runtime.execute({ agentId: 'remember', input: 'Second message', tools: [], context: { userId: 'alice', threadId: 'thread-a' } });
    expect(inputProcessor.processInput).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(inputProcessor.processInput.mock.calls[1][0].messages)).toContain('First message');
  });
  it('restarts a failed durable run with its original input', async () => {
    let calls = 0;
    const runtime = new MastraRunAdapter({ dbPath: ':memory:' });
    runtime.register({ id: 'retry', execute: async input => { if (++calls === 1) throw new Error('transient'); return { original: input.value }; } });
    expect((await runtime.start({ workflowId: 'retry', userId: 'alice', runId: 'retry1', input: { value: 7 } })).status).toBe('failed');
    const result = await runtime.recover({ workflowId: 'retry', userId: 'alice', runId: 'retry1' });
    expect(result.result).toEqual({ original: 7 });
  });
  it('preserves nested arrays, integer constraints and enums', () => {
    const schema = { type: 'object', additionalProperties: false, required: ['rows'], properties: {
      rows: { type: 'array', minItems: 1, items: { type: 'object', required: ['n', 'kind'], properties: {
        n: { type: 'integer', minimum: 1 }, kind: { type: 'string', enum: ['food'] },
      } } },
    } };
    const bridge = standardSchema(schema)['~standard'];
    expect(bridge.jsonSchema.input()).toEqual(schema);
    expect(bridge.validate({ rows: [{ n: 1.2, kind: 'anything' }] }).issues).toHaveLength(2);
    expect(bridge.validate({ rows: [{ n: 1, kind: 'food' }] }).value).toBeTruthy();
  });
  it('uses the actual SDK to generate a validated structured result', async () => {
    const runtime = adapter({ model: model('{"ok":true}') });
    const result = await runtime.execute({ agentId: 'fixture', input: 'Return JSON', tools: [],
      systemPrompt: 'Return the requested JSON.', outputSchema: {
        type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } }, additionalProperties: false,
      } });
    expect(result.structured).toEqual({ ok: true });
    expect(result.status).toBe('completed');
  });
  it('actually attaches processors and aborts a non-cooperative model', async () => {
    let options;
    class FakeAgent {
      constructor(config) { expect(config.inputProcessors).toHaveLength(1); }
      async generate(_input, opts) { options = opts; return new Promise(() => {}); }
    }
    const runtime = adapter({ agentClass: FakeAgent, inputProcessors: [{ id: 'fixture' }] });
    await expect(runtime.execute({ agentId: 'timeout', input: 'hi', tools: [], limits: { timeoutMs: 15 } })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(options.abortSignal.aborted).toBe(true);
  });
  it('recovers a suspended workflow from persistent storage and enforces owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-run-test-'));
    try {
      const definition = { id: 'ask', execute: async (input, context) => context.resumeData
        ? { answer: context.resumeData.answer, userId: context.userId }
        : { status: 'waiting', interaction: { question: 'Which?' } } };
      const first = new MastraRunAdapter({ dbPath: join(dir, 'runs.db') });
      first.register(definition);
      expect((await first.start({ workflowId: 'ask', userId: 'alice', runId: 'r1', input: {} })).status).toBe('suspended');
      const second = new MastraRunAdapter({ dbPath: join(dir, 'runs.db') });
      second.register(definition);
      await expect(second.get({ workflowId: 'ask', userId: 'bob', runId: 'r1' })).rejects.toMatchObject({ status: 404 });
      const result = await second.resume({ workflowId: 'ask', userId: 'alice', runId: 'r1', data: { answer: 'A' } });
      expect(result.result).toEqual({ answer: 'A', userId: 'alice' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
