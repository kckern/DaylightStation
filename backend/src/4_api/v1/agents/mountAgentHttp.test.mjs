// backend/src/4_api/v1/agents/mountAgentHttp.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mountAgentHttp } from './mountAgentHttp.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function postJson(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST', hostname: 'localhost', port, path,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c.toString(); });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: buf ? JSON.parse(buf) : null,
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function postSSE(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST', hostname: 'localhost', port, path,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let buf = '';
      const events = [];
      res.on('data', (chunk) => {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, events }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

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
      expect(orchestrator.run).toHaveBeenCalledWith('echo', 'hi', { userId: 'kc' });
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
      expect(orchestrator.run).toHaveBeenCalledWith('echo', 'hi', { userId: 'kc', injectedFlag: true });
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
