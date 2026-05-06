// backend/src/4_api/v1/agents/mountAgentHttp.openai.test.mjs
import { describe, it, expect } from 'vitest';
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

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'GET', hostname: 'localhost', port, path,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c.toString(); });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: buf ? JSON.parse(buf) : null,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeOrchestrator(overrides = {}) {
  return {
    run: async (_agentId, messages, _ctx) => ({
      content: 'Hello from the kitchen.',
      output: 'Hello from the kitchen.',
      toolCalls: [],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    }),
    streamExecute: async function* (_agentId, messages, _ctx) {
      yield { type: 'text-delta', text: 'Hello' };
      yield { type: 'finish', reason: 'stop' };
    },
    ...overrides,
  };
}

describe('mountAgentHttp — openai-chat-completions wire format', () => {
  it('POST /chat/completions returns chat.completion envelope (non-stream)', async () => {
    const app = express();
    app.use(express.json());
    mountAgentHttp(app, {
      orchestrator: makeOrchestrator(),
      agentId: 'concierge',
      mountPath: '/api/v1/concierge',
      wireFormat: 'openai-chat-completions',
      logger: silentLogger,
    });
    const { server, port } = await startServer(app);

    try {
      const result = await postJson(port, '/api/v1/concierge/chat/completions', {
        model: 'daylight-house',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      });

      expect(result.status).toBe(200);
      expect(result.body.object).toBe('chat.completion');
      expect(result.body.choices[0].message.role).toBe('assistant');
      expect(result.body.choices[0].message.content).toBe('Hello from the kitchen.');
      expect(result.body.choices[0].finish_reason).toBe('stop');
      expect(result.body.usage).toEqual({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 });
    } finally {
      server.close();
    }
  });

  it('POST /chat/completions with empty messages returns 400', async () => {
    const app = express();
    app.use(express.json());
    mountAgentHttp(app, {
      orchestrator: makeOrchestrator(),
      agentId: 'concierge',
      mountPath: '/api/v1/concierge',
      wireFormat: 'openai-chat-completions',
      logger: silentLogger,
    });
    const { server, port } = await startServer(app);

    try {
      const result = await postJson(port, '/api/v1/concierge/chat/completions', {
        model: 'daylight-house',
        messages: [],
        stream: false,
      });

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('bad_request');
    } finally {
      server.close();
    }
  });

  it('GET /models returns model list', async () => {
    const app = express();
    app.use(express.json());
    mountAgentHttp(app, {
      orchestrator: makeOrchestrator(),
      agentId: 'concierge',
      mountPath: '/api/v1/concierge',
      wireFormat: 'openai-chat-completions',
      advertisedModels: ['daylight-house', 'daylight-mini'],
      logger: silentLogger,
    });
    const { server, port } = await startServer(app);

    try {
      const result = await getJson(port, '/api/v1/concierge/models');

      expect(result.status).toBe(200);
      expect(result.body.object).toBe('list');
      expect(result.body.data.map((m) => m.id)).toEqual(['daylight-house', 'daylight-mini']);
      expect(result.body.data[0].object).toBe('model');
      expect(result.body.data[0].owned_by).toBe('daylight');
    } finally {
      server.close();
    }
  });
});
