// tests/isolated/agents/concierge/concierge-smoke.test.mjs
//
// Synthetic HA Voice smoke test — Phase 3 gate.
//
// Does NOT start a real HTTP server. Constructs the full stack with stub
// runtime + working memory, sends a synthetic OpenAI-shaped request via
// mountAgentHttp + openai-chat-completions wire format, and asserts on
// response shape.
//
// Stack under test:
//   ConciergeAgent → AgentOrchestrator → mountAgentHttp(openai-chat-completions)

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

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

const PassThroughPolicy = {
  evaluateRequest: () => ({ allow: true }),
  evaluateToolCall: () => ({ allow: true }),
  shapeResponse: (_s, d) => d,
};

// ─── Build test app ───────────────────────────────────────────────────────────

async function buildApp({ agentRuntime, policy = PassThroughPolicy, satellite }) {
  const { ConciergeAgent } = await import('../../../../backend/src/3_applications/agents/concierge/ConciergeAgent.mjs');
  const { AgentOrchestrator } = await import('../../../../backend/src/3_applications/agents/AgentOrchestrator.mjs');
  const { MemoryBundle } = await import('../../../../backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs');
  const { mountAgentHttp } = await import('../../../../backend/src/4_api/v1/agents/mountAgentHttp.mjs');

  const orchestrator = new AgentOrchestrator({ agentRuntime, logger: makeLogger() });
  orchestrator.register(ConciergeAgent, {
    policy,
    toolBundles: [new MemoryBundle({})],
    workingMemory: makeWorkingMemory(),
  });

  const app = express();
  app.use(express.json());

  // Inject satellite directly into req — bypasses network auth for unit testing
  const injectSatellite = (req, _res, next) => { req.satellite = satellite; next(); };

  mountAgentHttp(app, {
    orchestrator,
    agentId: ConciergeAgent.id,
    mountPath: '/v1',
    wireFormat: 'openai-chat-completions',
    authMiddleware: [injectSatellite],
    contextExtractor: (req) => ({
      satellite: req.satellite,
      conversationId: req.body?.conversation_id ?? req.body?.conversationId ?? null,
    }),
    advertisedModels: ['daylight-house', 'gpt-4o-mini'],
    logger: makeLogger(),
  });

  return app;
}

// ─── Suite 1: non-stream path ─────────────────────────────────────────────────

describe('concierge smoke — non-stream path', () => {
  it('returns a valid OpenAI chat.completion envelope', async () => {
    const satellite = makeSatellite();
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

    const app = await buildApp({ agentRuntime, satellite });

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'daylight-house',
        stream: false,
        messages: [{ role: 'user', content: 'Please remember that dogs are allowed.' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('chat.completion');
    expect(Array.isArray(res.body.choices)).toBe(true);
    expect(res.body.choices[0].message.role).toBe('assistant');
    expect(res.body.choices[0].message.content).toMatch(/saved|note|hello/i);
  });

  it('calls the agent runtime (LLM stub was invoked)', async () => {
    const satellite = makeSatellite();
    const runtimeExecute = vi.fn(async () => ({ output: 'ok', toolCalls: [], usage: null }));
    const agentRuntime = { execute: runtimeExecute, streamExecute: async function* () {} };

    const app = await buildApp({ agentRuntime, satellite });

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'daylight-house', stream: false, messages: [{ role: 'user', content: 'hello' }] });

    expect(res.status).toBe(200);
    expect(runtimeExecute).toHaveBeenCalledOnce();
  });

  it('GET /v1/models returns advertised list', async () => {
    const satellite = makeSatellite();
    const agentRuntime = { execute: vi.fn(), streamExecute: async function* () {} };

    const app = await buildApp({ agentRuntime, satellite });

    const res = await request(app).get('/v1/models');

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.data.map((m) => m.id)).toContain('daylight-house');
  });
});

// ─── Suite 2: policy deny path ────────────────────────────────────────────────

describe('concierge smoke — policy deny path', () => {
  it('returns a refusal without calling the LLM when request is denied', async () => {
    const satellite = makeSatellite();
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

    const app = await buildApp({ agentRuntime, policy: DenyAllPolicy, satellite });

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'daylight-house', stream: false, messages: [{ role: 'user', content: 'do something' }] });

    // LLM must NOT have been called
    expect(runtimeExecute).not.toHaveBeenCalled();

    // Response must still be a valid OpenAI envelope
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('chat.completion');
    expect(res.body.choices[0].message.role).toBe('assistant');

    // ConciergeAgent.#refusalContent() formats: "I can't do that right now — {reason}."
    const content = res.body.choices[0].message.content;
    expect(content).toMatch(/can't do that/i);
    expect(content).toContain('test_deny');
  });

  it('ConciergeAgent.run() returns refusal output directly without hitting runtime', async () => {
    // This test isolates the agent layer to confirm the refusal shape before the wire format.
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
