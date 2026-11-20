import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  createFrontendStaticRouter,
  frameAncestorsPolicy,
  setFrontendDocumentHeaders,
  conciergeContextFromRequest,
  crossOriginIsolationHeaders,
  skipWebSocketPaths,
} from './platformHttp.mjs';

describe('platform HTTP middleware', () => {
  it('sets the established cross-origin isolation headers', () => {
    const res = { setHeader: vi.fn() };
    const next = vi.fn();
    crossOriginIsolationHeaders({}, res, next);
    expect(res.setHeader.mock.calls).toEqual([
      ['Cross-Origin-Opener-Policy', 'same-origin'],
      ['Cross-Origin-Embedder-Policy', 'credentialless'],
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

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

  describe('frame-ancestors: only the app (and listed origins) may frame its pages', () => {
    it('builds the policy from the allow-list, and none when switched off', () => {
      expect(frameAncestorsPolicy()).toBe("frame-ancestors 'self'");
      expect(frameAncestorsPolicy({ allowedOrigins: new Set(['https://partner.example']) })).toBe("frame-ancestors 'self' https://partner.example");
      expect(frameAncestorsPolicy({ enabled: false })).toBeNull();
    });

    it('sets it on frontend documents with the existing headers', () => {
      const headers = {};
      setFrontendDocumentHeaders({ setHeader: (k, v) => { headers[k] = v; } }, { frameAncestors: "frame-ancestors 'self'" });
      expect(headers).toEqual({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Document-Policy': 'js-profiling',
        'Content-Security-Policy': "frame-ancestors 'self'",
      });
      const off = {};
      setFrontendDocumentHeaders({ setHeader: (k, v) => { off[k] = v; } }, { frameAncestors: null });
      expect(off['Content-Security-Policy']).toBeUndefined();
    });

    it('the static router sends it for index.html and SPA routes, not for assets', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-'));
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
      fs.writeFileSync(path.join(dir, 'app.js'), '1');
      const app = express();
      app.use(createFrontendStaticRouter({ frontendPath: dir, frameAncestors: "frame-ancestors 'self'" }));
      for (const url of ['/', '/index.html', '/fitness']) {
        const res = await request(app).get(url);
        expect(res.headers['content-security-policy'], url).toBe("frame-ancestors 'self'");
      }
      expect((await request(app).get('/app.js')).headers['content-security-policy']).toBeUndefined();
      // Every static HTML page, not only index.html (sim panel, arcade film, probes, labs).
      fs.writeFileSync(path.join(dir, 'sim-panel.html'), '<!doctype html>');
      fs.mkdirSync(path.join(dir, 'crt-lab'));
      fs.writeFileSync(path.join(dir, 'crt-lab', 'verify.HTM'), '<!doctype html>');
      for (const url of ['/sim-panel.html', '/crt-lab/verify.HTM']) {
        const res = await request(app).get(url);
        expect(res.status, url).toBe(200);
        expect(res.headers['content-security-policy'], url).toBe("frame-ancestors 'self'");
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
