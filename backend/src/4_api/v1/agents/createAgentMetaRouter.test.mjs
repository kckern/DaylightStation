// backend/src/4_api/v1/agents/createAgentMetaRouter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createAgentMetaRouter } from './createAgentMetaRouter.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function startServer(app) {
  return new Promise((r) => { const s = app.listen(0, () => r({ server: s, port: s.address().port })); });
}
function req(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ method, hostname: 'localhost', port, path, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = ''; res.on('data', (c) => buf += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

describe('createAgentMetaRouter', () => {
  it('GET / lists registered agents', async () => {
    const orchestrator = {
      list: () => [{ id: 'echo', description: 'd1' }, { id: 'health-coach', description: 'd2' }],
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents');
      expect(r.status).toBe(200);
      expect(r.body.agents).toEqual([
        { id: 'echo', description: 'd1' },
        { id: 'health-coach', description: 'd2' },
      ]);
    } finally { server.close(); }
  });

  it('GET /:agentId/assignments returns 404 when agent missing', async () => {
    const orchestrator = { list: () => [], has: () => false, listInstances: () => [] };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/foo/assignments');
      expect(r.status).toBe(404);
    } finally { server.close(); }
  });

  it('GET /:agentId/assignments enumerates assignments', async () => {
    class FakeAssignment { static id = 'daily'; static description = 'Daily digest'; static schedule = '0 7 * * *'; }
    const fakeAgent = { constructor: { id: 'echo' }, getAssignments: () => [new FakeAssignment()] };
    const orchestrator = {
      list: () => [{ id: 'echo' }],
      has: () => true,
      listInstances: () => [fakeAgent],
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/echo/assignments');
      expect(r.status).toBe(200);
      expect(r.body.assignments).toEqual([{ id: 'daily', description: 'Daily digest', schedule: '0 7 * * *' }]);
    } finally { server.close(); }
  });

  it('POST /:agentId/assignments/:assignmentId/run delegates to orchestrator', async () => {
    const orchestrator = {
      list: () => [{ id: 'echo' }],
      has: () => true,
      listInstances: () => [],
      runAssignment: vi.fn(async () => ({ output: 'ran' })),
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('POST', port, '/api/v1/agents/echo/assignments/daily/run', { userId: 'kc' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ agentId: 'echo', assignmentId: 'daily', status: 'complete' });
      expect(orchestrator.runAssignment).toHaveBeenCalledWith('echo', 'daily', expect.objectContaining({ userId: 'kc', triggeredBy: 'api' }));
    } finally { server.close(); }
  });

  it('throws when orchestrator is missing', () => {
    expect(() => createAgentMetaRouter({})).toThrow('orchestrator required');
  });
});
