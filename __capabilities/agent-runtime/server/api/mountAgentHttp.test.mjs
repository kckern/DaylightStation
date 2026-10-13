// __backend/src/4_api/v1/agents/mountAgentHttp.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { startServer, postJson, postSSE } from "../../../../tests/_lib/memory-http/agent-http-memory-transport.mjs";
import { mountAgentHttp } from "./mountAgentHttp.mjs";

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };







describe('mountAgentHttp(native)', () => {
  it('POST /run delegates to orchestrator.run and returns JSON envelope', async () => {
    const orchestrator = {
      run: vi.fn(async () => ({ output: 'echo: hi', toolCalls: [] })),
      streamExecute: vi.fn(),
      runInBackground: vi.fn(),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'echo', mountPath: '/api/v1/agents',
      wireFormat: 'native', logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/api/v1/agents/echo/run', { input: 'hi', context: { userId: 'kc' } });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ agentId: 'echo', output: 'echo: hi', toolCalls: [] });
      // parseRequest normalises a bare `input` into a messages array and
      // resolves a threadId; both travel with the context to the orchestrator.
      expect(orchestrator.run).toHaveBeenCalledWith('echo', 'hi', {
        userId: 'kc',
        messages: [{ role: 'user', content: 'hi' }],
        threadId: null,
      });
    } finally { server.close(); }
  });

  it('POST /run returns 400 when input missing', async () => {
    const orchestrator = { run: vi.fn(), streamExecute: vi.fn(), runInBackground: vi.fn(), has: () => true };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, { orchestrator, agentId: 'echo', mountPath: '/api/v1/agents', wireFormat: 'native', logger: silentLogger });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/api/v1/agents/echo/run', {});
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it('POST /run-stream emits SSE in order ending with done', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'Hi ' };
      yield { type: 'tool-start', toolName: 'foo', args: {} };
      yield { type: 'tool-end', toolName: 'foo', result: { ok: true } };
      yield { type: 'finish', reason: 'stop' };
    }
    const orchestrator = {
      run: vi.fn(),
      streamExecute: vi.fn(() => gen()),
      runInBackground: vi.fn(),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, { orchestrator, agentId: 'health-coach', mountPath: '/api/v1/agents', wireFormat: 'native', logger: silentLogger });
    const { server, port } = await startServer(app);
    try {
      const r = await postSSE(port, '/api/v1/agents/health-coach/run-stream', { input: 'hi', context: { userId: 'kc' } });
      expect(r.status).toBe(200);
      expect(r.headers['x-accel-buffering']).toBe('no');
      expect(r.events.map((e) => e.type)).toEqual(['text-delta', 'tool-start', 'tool-end', 'finish', 'done']);
    } finally { server.close(); }
  });

  it('POST /run-background returns 202 with taskId', async () => {
    const orchestrator = {
      run: vi.fn(),
      streamExecute: vi.fn(),
      runInBackground: vi.fn(async () => ({ taskId: 'task-abc' })),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, { orchestrator, agentId: 'echo', mountPath: '/api/v1/agents', wireFormat: 'native', logger: silentLogger });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/api/v1/agents/echo/run-background', { input: 'hi' });
      expect(r.status).toBe(202);
      expect(r.body).toMatchObject({ agentId: 'echo', taskId: 'task-abc', status: 'accepted' });
    } finally { server.close(); }
  });

  it('contextExtractor merges into context passed to orchestrator', async () => {
    const orchestrator = {
      run: vi.fn(async () => ({ output: 'ok' })),
      streamExecute: vi.fn(),
      runInBackground: vi.fn(),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'echo', mountPath: '/api/v1/agents', wireFormat: 'native',
      contextExtractor: (_req) => ({ injectedFlag: true }),
      logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      await postJson(port, '/api/v1/agents/echo/run', { input: 'hi', context: { userId: 'kc' } });
      expect(orchestrator.run).toHaveBeenCalledWith('echo', 'hi', {
        userId: 'kc',
        injectedFlag: true,
        messages: [{ role: 'user', content: 'hi' }],
        threadId: null,
      });
    } finally { server.close(); }
  });

  it('runs authMiddleware before the route handler', async () => {
    const orchestrator = { run: vi.fn(async () => ({ output: 'ok' })), streamExecute: vi.fn(), runInBackground: vi.fn(), has: () => true };
    const authCalls = [];
    const auth = (req, res, next) => { authCalls.push(req.path); next(); };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'echo', mountPath: '/api/v1/agents',
      wireFormat: 'native', authMiddleware: [auth], logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      await postJson(port, '/api/v1/agents/echo/run', { input: 'hi' });
      expect(authCalls.length).toBeGreaterThan(0);
    } finally { server.close(); }
  });
});
