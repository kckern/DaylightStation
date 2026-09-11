// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import { createApiRouter } from './api.mjs';

// The AI router was built in app.mjs for months and never mounted: /api/v1/ai/*
// answered 404 while the adapters behind it worked. The mount is a line in a
// map, which is exactly the kind of line that goes missing, so it is pinned.
describe('api router mounts the ai router', () => {
  it('routes /ai to the router handed in as `ai`', async () => {
    const ai = express.Router();
    ai.get('/', (_req, res) => res.json({ ok: true, from: 'ai' }));
    const api = createApiRouter({
      safeConfig: {},
      routers: { ai },
      plexProxyHandler: (_req, res) => res.status(501).end(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    const app = express();
    app.use('/api/v1', api);
    const server = app.listen(0);
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ai/`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, from: 'ai' });
    } finally {
      server.close();
    }
  });
});
