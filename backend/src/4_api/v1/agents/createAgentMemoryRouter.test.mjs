// backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createAgentMemoryRouter } from './createAgentMemoryRouter.mjs';
import { WorkingMemoryState } from '#apps/agents/framework/WorkingMemory.mjs';

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

describe('createAgentMemoryRouter', () => {
  function setup({ has = () => true, store = new Map() } = {}) {
    const orchestrator = { has };
    const workingMemory = {
      load: async (agentId, userId) => {
        const key = `${agentId}/${userId}`;
        if (!store.has(key)) store.set(key, new WorkingMemoryState());
        return store.get(key);
      },
      save: async (agentId, userId, state) => { store.set(`${agentId}/${userId}`, state); },
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMemoryRouter({ orchestrator, workingMemory, logger: silentLogger }));
    return { app, store, workingMemory };
  }

  it('GET /:agentId/memory/:userId returns the entries', async () => {
    const store = new Map();
    const state = new WorkingMemoryState();
    state.set('note', 'hello');
    store.set('echo/kc', state);
    const { app } = setup({ store });
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/echo/memory/kc');
      expect(r.status).toBe(200);
      expect(r.body.entries.note).toBeDefined();
    } finally { server.close(); }
  });

  it('GET returns 404 when agent not registered', async () => {
    const { app } = setup({ has: () => false });
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/missing/memory/kc');
      expect(r.status).toBe(404);
    } finally { server.close(); }
  });

  it('DELETE /:agentId/memory/:userId clears all entries', async () => {
    const store = new Map();
    const state = new WorkingMemoryState();
    state.set('a', 'x'); state.set('b', 'y');
    store.set('echo/kc', state);
    const { app } = setup({ store });
    const { server, port } = await startServer(app);
    try {
      const r = await req('DELETE', port, '/api/v1/agents/echo/memory/kc');
      expect(r.status).toBe(200);
      expect(r.body.cleared).toBe(true);
      expect(store.get('echo/kc').getAll()).toEqual({});
    } finally { server.close(); }
  });

  it('DELETE /:agentId/memory/:userId/:key removes one entry', async () => {
    const store = new Map();
    const state = new WorkingMemoryState();
    state.set('a', 'x'); state.set('b', 'y');
    store.set('echo/kc', state);
    const { app } = setup({ store });
    const { server, port } = await startServer(app);
    try {
      const r = await req('DELETE', port, '/api/v1/agents/echo/memory/kc/a');
      expect(r.status).toBe(200);
      expect(r.body.deleted).toBe(true);
      expect(store.get('echo/kc').get('a')).toBeUndefined();
      expect(store.get('echo/kc').get('b')).toBeDefined();
    } finally { server.close(); }
  });

  it('throws when orchestrator is missing', () => {
    expect(() => createAgentMemoryRouter({ workingMemory: {} })).toThrow('orchestrator required');
  });

  it('throws when workingMemory is missing', () => {
    expect(() => createAgentMemoryRouter({ orchestrator: {} })).toThrow('workingMemory required');
  });
});
