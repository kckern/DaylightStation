// tests/isolated/api/routers/agents.runStream.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { createAgentsStreamRouter } from '../../../../backend/src/4_api/v1/routers/agents-stream.mjs';
import http from 'node:http';

function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function readSSE(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST',
      hostname: 'localhost',
      port,
      path,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let buffer = '';
      const events = [];
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
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

describe('POST /api/v1/agents/:id/run-stream', () => {
  it('streams SSE events in order, ending with done', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'Hi ' };
      yield { type: 'tool-start', toolName: 'metric_trajectory', args: { metric: 'weight_lbs' } };
      yield { type: 'tool-end', toolName: 'metric_trajectory', result: { slope: -0.04 } };
      yield { type: 'text-delta', text: 'there' };
      yield { type: 'finish', reason: 'stop' };
    }
    const orchestrator = { streamExecute: vi.fn(() => fakeStream()) };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/agents', createAgentsStreamRouter({ orchestrator, logger: { info: () => {}, error: () => {} } }));

    const { server, port } = await startServer(app);
    try {
      const { status, headers, events } = await readSSE(port, '/api/v1/agents/health-coach/run-stream', { input: 'hi', context: { userId: 'kc' } });
      expect(status).toBe(200);
      expect(headers['content-type']).toMatch(/text\/event-stream/);
      expect(events.map(e => e.type)).toEqual(['text-delta', 'tool-start', 'tool-end', 'text-delta', 'finish', 'done']);
    } finally {
      server.close();
    }
  });

  it('returns 400 when input missing', async () => {
    const orchestrator = { streamExecute: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/agents', createAgentsStreamRouter({ orchestrator, logger: { info: () => {}, error: () => {} } }));

    const { server, port } = await startServer(app);
    try {
      const { status } = await readSSE(port, '/api/v1/agents/health-coach/run-stream', {});
      expect(status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('emits an error event when streamExecute throws', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('boom');
    }
    const orchestrator = { streamExecute: vi.fn(() => fakeStream()) };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/agents', createAgentsStreamRouter({ orchestrator, logger: { info: () => {}, error: () => {} } }));

    const { server, port } = await startServer(app);
    try {
      const { events } = await readSSE(port, '/api/v1/agents/health-coach/run-stream', { input: 'hi' });
      expect(events.find(e => e.type === 'error')).toBeDefined();
    } finally {
      server.close();
    }
  });
});
