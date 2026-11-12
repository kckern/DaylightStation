import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  conciergeContextFromRequest,
  createCrossOriginIsolationMiddleware,
  createFrontendStaticRouter,
  skipWebSocketPaths,
} from './platformHttp.mjs';
import { resolveCrossOriginIsolationPolicy } from '#shared/contracts/crossOriginIsolation.mjs';

const COOP = 'cross-origin-opener-policy';
const COEP = 'cross-origin-embedder-policy';

/**
 * A real Express stack in the production order: isolation middleware first,
 * then the static + SPA-fallback router, then a stand-in API router. Requests
 * go over a real socket so what is asserted is what a browser would receive.
 */
async function withServer({ fitnessConfig = null, env = {}, getPolicy } = {}, run) {
  const frontendPath = mkdtempSync(join(tmpdir(), 'coi-frontend-'));
  writeFileSync(join(frontendPath, 'index.html'), '<!doctype html><title>spa</title>');
  writeFileSync(join(frontendPath, 'sim-panel.html'), '<!doctype html><title>sim</title>');
  writeFileSync(join(frontendPath, 'tfjs-backend-wasm-threaded-simd.wasm'), 'wasm');

  const app = express();
  app.use(createCrossOriginIsolationMiddleware({
    getPolicy: getPolicy || (() => resolveCrossOriginIsolationPolicy(fitnessConfig, env)),
  }));
  app.use(createFrontendStaticRouter({ frontendPath }));
  app.get('/api/v1/fitness', (_req, res) => res.json({ ok: true }));
  app.get('/api/v1/ping', (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // node:http, not fetch: under the test environment `fetch` is a browser
  // shim that applies the same-origin policy to a loopback server.
  const head = (path) => new Promise((resolve, reject) => {
    http.get(`${base}${path}`, (res) => {
      res.resume();
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'],
        coop: res.headers[COOP] ?? null,
        coep: res.headers[COEP] ?? null,
      }));
    }).on('error', reject);
  });
  try {
    await run(head);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(frontendPath, { recursive: true, force: true });
  }
}

const isolated = { coop: 'same-origin', coep: 'credentialless' };
const plain = { coop: null, coep: null };

describe('cross-origin isolation middleware', () => {
  it('isolates the Fitness document on every Fitness route', async () => {
    await withServer({}, async (head) => {
      for (const path of ['/fitness', '/fitness/', '/fitness/menu/123', '/fitness/play/plex:456?x=1']) {
        const res = await head(path);
        expect(res.status, path).toBe(200);
        expect(res.type, path).toMatch(/text\/html/);
        expect({ coop: res.coop, coep: res.coep }, path).toEqual(isolated);
      }
    });
  });

  it('isolates the sim panel popup so it keeps window.opener', async () => {
    await withServer({}, async (head) => {
      const res = await head('/sim-panel.html');
      expect(res.status).toBe(200);
      expect({ coop: res.coop, coep: res.coep }).toEqual(isolated);
    });
  });

  it('leaves every other app document alone, though it is the same index.html', async () => {
    await withServer({}, async (head) => {
      for (const path of ['/', '/piano', '/school/today', '/health', '/fitnessx', '/tv/fitness']) {
        const res = await head(path);
        expect(res.status, path).toBe(200);
        expect(res.type, path).toMatch(/text\/html/);
        expect({ coop: res.coop, coep: res.coep }, path).toEqual(plain);
      }
    });
  });

  it('leaves API responses alone, including the fitness API', async () => {
    await withServer({}, async (head) => {
      for (const path of ['/api/v1/fitness', '/api/v1/ping']) {
        const res = await head(path);
        expect(res.status, path).toBe(200);
        expect({ coop: res.coop, coep: res.coep }, path).toEqual(plain);
      }
    });
  });

  it('serves the threaded wasm same-origin without needing the headers', async () => {
    await withServer({}, async (head) => {
      const res = await head('/tfjs-backend-wasm-threaded-simd.wasm');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/application\/wasm/);
      expect({ coop: res.coop, coep: res.coep }).toEqual(plain);
    });
  });

  it('sends no headers anywhere when the config flag is off', async () => {
    await withServer({ fitnessConfig: { cross_origin_isolation: { enabled: false } } }, async (head) => {
      for (const path of ['/fitness', '/fitness/menu/123', '/sim-panel.html', '/']) {
        const res = await head(path);
        expect(res.status, path).toBe(200);
        expect({ coop: res.coop, coep: res.coep }, path).toEqual(plain);
      }
    });
  });

  it('sends no headers anywhere when the env kill switch is set', async () => {
    await withServer({ env: { DAYLIGHT_CROSS_ORIGIN_ISOLATION: 'off' } }, async (head) => {
      const res = await head('/fitness');
      expect({ coop: res.coop, coep: res.coep }).toEqual(plain);
    });
  });

  it('follows configured paths', async () => {
    const fitnessConfig = { cross_origin_isolation: { paths: ['/fitness', '/piano/'] } };
    await withServer({ fitnessConfig }, async (head) => {
      expect(await head('/piano/games')).toMatchObject(isolated);
      expect(await head('/fitness')).toMatchObject(isolated);
      expect(await head('/sim-panel.html')).toMatchObject(plain);
      expect(await head('/school')).toMatchObject(plain);
    });
  });

  it('re-reads the policy per request, so a config reload applies without a restart', async () => {
    let fitnessConfig = {};
    const getPolicy = () => resolveCrossOriginIsolationPolicy(fitnessConfig, {});
    await withServer({ getPolicy }, async (head) => {
      expect(await head('/fitness')).toMatchObject(isolated);
      fitnessConfig = { cross_origin_isolation: { enabled: false } };
      expect(await head('/fitness')).toMatchObject(plain);
      fitnessConfig = { cross_origin_isolation: { enabled: true } };
      expect(await head('/fitness')).toMatchObject(isolated);
    });
  });

  it('serves the page without headers when the policy cannot be resolved', async () => {
    const logger = { warn: vi.fn() };
    const middleware = createCrossOriginIsolationMiddleware({
      getPolicy: () => { throw new Error('config not loaded'); },
      logger,
    });
    const res = { setHeader: vi.fn() };
    const next = vi.fn();
    middleware({ path: '/fitness' }, res, next);
    middleware({ path: '/fitness' }, res, next);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledWith();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('http.cross_origin_isolation.policy_failed', { error: 'config not loaded' });
  });

  it('refuses to be built without a policy source', () => {
    expect(() => createCrossOriginIsolationMiddleware({})).toThrow(/getPolicy/);
  });
});

describe('platform HTTP middleware', () => {
  it('preserves websocket bypass behavior', () => {
    const next = vi.fn();
    skipWebSocketPaths({ path: '/ws/device' }, {}, next);
    expect(next).toHaveBeenCalledWith('route');
  });

  it('preserves the concierge request context shape', () => {
    expect(conciergeContextFromRequest({
      satellite: { id: 'kitchen' },
      body: { conversation_id: 'thread-1' },
    })).toEqual({ satellite: { id: 'kitchen' }, conversationId: 'thread-1' });
  });
});
