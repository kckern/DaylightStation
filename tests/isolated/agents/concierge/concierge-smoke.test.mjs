// tests/isolated/agents/concierge/concierge-smoke.test.mjs
//
// Synthetic HA Voice smoke test — Phase 2 gate.
//
// Does NOT start a real HTTP server. Constructs the full stack with stub
// runtime + working memory, sends a synthetic OpenAI-shaped request, and
// asserts on response shape and transcript side-effects.
//
// Stack under test:
//   ConciergeAgent → AgentOrchestrator → bridge → OpenAIChatCompletionsTranslator → AgentTranscript
//
// Shape contract: AgentOrchestrator.run() returns { output, toolCalls, usage }.
// The bridge in bootstrap.mjs translates this to { content, toolCalls, usage } so
// that OpenAIChatCompletionsTranslator (which reads result.content) receives the
// correct field. The makeBridge helper below mirrors that translation.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeSatellite(allowedSkills = ['memory']) {
  return {
    id: 'kitchen',
    area: 'kitchen',
    allowedSkills,
    canUseSkill: (name) => allowedSkills.includes(name),
    scopes_allowed: [],
    scopes_denied: [],
  };
}

function makeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function makeWorkingMemory() {
  const store = new Map();
  return {
    load: vi.fn(async (_agentId, _userId) => ({
      get: (key) => store.get(key) ?? null,
      set: (key, val) => store.set(key, val),
      serialize: () => '',
    })),
    save: vi.fn(),
  };
}

/**
 * Minimal bridge that mirrors bootstrap.mjs's chatCompletionRunner exactly —
 * calls AgentOrchestrator.run() and translates { output, toolCalls, usage }
 * → { content, toolCalls, usage } so the translator receives result.content.
 */
function makeBridge(orchestrator, agentId) {
  function lastUserMessage(messages) {
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
        return messages[i].content;
      }
    }
    return '';
  }

  return {
    async runChat({ satellite, messages, conversationId = null, transcript = null }) {
      const input = lastUserMessage(messages);
      const result = await orchestrator.run(agentId, input, {
        satellite,
        conversationId,
        transcript,
        userId: 'household',
      });
      return {
        content: result?.output ?? '',
        toolCalls: result?.toolCalls ?? [],
        usage: result?.usage ?? null,
      };
    },
    async *streamChat({ satellite, messages, conversationId = null, transcript = null }) {
      const input = lastUserMessage(messages);
      yield* orchestrator.streamExecute(agentId, input, {
        satellite,
        conversationId,
        transcript,
        userId: 'household',
      });
    },
  };
}

function makeRes() {
  let responseBody = null;
  const res = {
    status: vi.fn(() => res),
    json: vi.fn((body) => { responseBody = body; }),
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    _body: () => responseBody,
  };
  return res;
}

// ─── Shared tmp dir ───────────────────────────────────────────────────────────

let tmpDir;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'concierge-smoke-'));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Suite 1: non-stream path ─────────────────────────────────────────────────

describe('concierge smoke — non-stream path', () => {
  it('returns a valid OpenAI chat.completion envelope', async () => {
    const { ConciergeAgent } = await import('../../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs');
    const { AgentOrchestrator } = await import('../../../../backend/src/3_applications/agents/AgentOrchestrator.mjs');
    const { MemoryBundle } = await import('../../../../backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs');
    const { OpenAIChatCompletionsTranslator } = await import('../../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs');

    const PassThroughPolicy = {
      evaluateRequest: () => ({ allow: true }),
      evaluateToolCall: () => ({ allow: true }),
      shapeResponse: (_s, d) => d,
    };

    const workingMemory = makeWorkingMemory();

    // AgentOrchestrator requires agentRuntime at the orchestrator level and injects
    // it into every registered agent (overriding any agentRuntime in register deps).
    // Runtime returns { output, toolCalls, usage } — the standard agent shape.
    const agentRuntime = {
      execute: vi.fn(async () => ({
        output: 'I have saved your note.',
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 10 },
      })),
      streamExecute: async function* () {
        yield { type: 'text-delta', text: 'Hello.' };
        yield { type: 'finish', reason: 'stop' };
      },
    };

    const orchestrator = new AgentOrchestrator({ agentRuntime, logger: makeLogger() });
    orchestrator.register(ConciergeAgent, {
      policy: PassThroughPolicy,
      toolBundles: [new MemoryBundle({})],
      workingMemory,
    });

    const bridge = makeBridge(orchestrator, ConciergeAgent.id);

    const translator = new OpenAIChatCompletionsTranslator({
      runner: bridge,
      logger: makeLogger(),
      mediaLogsDir: tmpDir,
    });

    const satellite = makeSatellite();
    const req = {
      body: {
        model: 'daylight-house',
        stream: false,
        messages: [{ role: 'user', content: 'Please remember that dogs are allowed.' }],
      },
    };

    const res = makeRes();
    await translator.handle(req, res, satellite);

    const body = res._body();
    expect(body).toBeTruthy();
    expect(body.object).toBe('chat.completion');
    expect(Array.isArray(body.choices)).toBe(true);
    expect(body.choices[0].message.role).toBe('assistant');
    // Bridge maps output → content; translator populates envelope with the string.
    expect(body.choices[0].message.content).toMatch(/saved|note|hello/i);
  });

  it('calls the agent runtime (LLM stub was invoked)', async () => {
    const { ConciergeAgent } = await import('../../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs');
    const { AgentOrchestrator } = await import('../../../../backend/src/3_applications/agents/AgentOrchestrator.mjs');
    const { OpenAIChatCompletionsTranslator } = await import('../../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs');

    const PassThroughPolicy = {
      evaluateRequest: () => ({ allow: true }),
      evaluateToolCall: () => ({ allow: true }),
      shapeResponse: (_s, d) => d,
    };

    const runtimeExecute = vi.fn(async () => ({ output: 'ok', toolCalls: [], usage: null }));
    const agentRuntime = { execute: runtimeExecute, streamExecute: async function* () {} };

    const orchestrator = new AgentOrchestrator({ agentRuntime, logger: makeLogger() });
    orchestrator.register(ConciergeAgent, {
      policy: PassThroughPolicy,
      toolBundles: [],
      workingMemory: makeWorkingMemory(),
    });

    const bridge = makeBridge(orchestrator, ConciergeAgent.id);
    const translator = new OpenAIChatCompletionsTranslator({
      runner: bridge,
      logger: makeLogger(),
      mediaLogsDir: tmpDir,
    });

    const res = makeRes();
    await translator.handle(
      { body: { model: 'daylight-house', stream: false, messages: [{ role: 'user', content: 'hello' }] } },
      res,
      makeSatellite(),
    );

    expect(runtimeExecute).toHaveBeenCalledOnce();
  });

  it('writes a transcript file with satellite snapshot', async () => {
    // Allow async flush to complete before scanning the directory
    await new Promise(r => setTimeout(r, 150));

    const files = await readdir(join(tmpDir, 'concierge'), { recursive: true }).catch(() => []);
    const jsonFiles = files.filter(f => typeof f === 'string' && f.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(0);

    const lastFile = jsonFiles.sort().at(-1);
    const fullPath = join(tmpDir, 'concierge', lastFile);
    const transcript = JSON.parse(await readFile(fullPath, 'utf8'));

    expect(transcript.satellite).toBeTruthy();
    expect(transcript.satellite.id).toBe('kitchen');
    expect(Array.isArray(transcript.satellite.allowedSkills)).toBe(true);
    expect(transcript.agentId).toBe('concierge');
    expect(transcript.status).toBe('ok');
  });
});

// ─── Suite 2: policy deny path ────────────────────────────────────────────────

describe('concierge smoke — policy deny path', () => {
  it('returns a refusal without calling the LLM when request is denied', async () => {
    const { ConciergeAgent } = await import('../../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs');
    const { AgentOrchestrator } = await import('../../../../backend/src/3_applications/agents/AgentOrchestrator.mjs');
    const { OpenAIChatCompletionsTranslator } = await import('../../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs');

    const DenyAllPolicy = {
      evaluateRequest: () => ({ allow: false, reason: 'test_deny' }),
      evaluateToolCall: () => ({ allow: false }),
      shapeResponse: (_s, d) => d,
    };

    const runtimeExecute = vi.fn();
    const agentRuntime = {
      execute: runtimeExecute,
      streamExecute: async function* () {},
    };

    const orchestrator = new AgentOrchestrator({ agentRuntime, logger: makeLogger() });
    orchestrator.register(ConciergeAgent, {
      policy: DenyAllPolicy,
      toolBundles: [],
      workingMemory: makeWorkingMemory(),
    });

    const bridge = makeBridge(orchestrator, ConciergeAgent.id);
    const translator = new OpenAIChatCompletionsTranslator({
      runner: bridge,
      logger: makeLogger(),
      mediaLogsDir: tmpDir,
    });

    const res = makeRes();
    await translator.handle(
      { body: { model: 'daylight-house', stream: false, messages: [{ role: 'user', content: 'do something' }] } },
      res,
      makeSatellite(),
    );

    // LLM must NOT have been called
    expect(runtimeExecute).not.toHaveBeenCalled();

    // Response must still be a valid OpenAI envelope
    const body = res._body();
    expect(body).toBeTruthy();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.role).toBe('assistant');

    // ConciergeAgent.#refusalContent() formats: "I can't do that right now — {reason}."
    // Bridge maps output → content; refusal text should appear in the envelope.
    const content = body.choices[0].message.content;
    expect(content).toMatch(/can't do that/i);
    expect(content).toContain('test_deny');
  });

  it('ConciergeAgent.run() returns refusal output directly without hitting runtime', async () => {
    // This test isolates the agent layer to confirm the refusal shape before the bridge.
    const { ConciergeAgent } = await import('../../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs');

    const DenyAllPolicy = {
      evaluateRequest: () => ({ allow: false, reason: 'test_deny' }),
      evaluateToolCall: () => ({ allow: true }),
      shapeResponse: (_s, d) => d,
    };

    const runtimeExecute = vi.fn();
    const agent = new ConciergeAgent({
      policy: DenyAllPolicy,
      toolBundles: [],
      agentRuntime: { execute: runtimeExecute, streamExecute: async function* () {} },
      workingMemory: makeWorkingMemory(),
      logger: makeLogger(),
    });

    const result = await agent.run('do something', {
      context: { satellite: makeSatellite(), userId: 'household' },
    });

    expect(runtimeExecute).not.toHaveBeenCalled();
    expect(result.output).toMatch(/can't do that/i);
    expect(result.output).toContain('test_deny');
  });
});
