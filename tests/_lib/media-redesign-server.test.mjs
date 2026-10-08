import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ACCEPTED_SOURCE_SHA,
  BRANCH_ALLOWED_TITLES,
  createAcceptancePreviewPlugin,
  requireExpectedSha,
  resolveAcceptanceBuildOutput,
  validateAcceptedSnapshot,
  validateArtifactProvenance,
  __setLiveEncoderSpawnForTests,
} from './media-redesign-server.mjs';

function attach(plugin, hook = 'configurePreviewServer') {
  const middlewares = [];
  plugin[hook]({ middlewares: { use: middleware => middlewares.push(middleware) } });
  return middlewares[0];
}

async function request(middleware, { url, method = 'GET' }) {
  const headers = new Map();
  let body = '';
  let nextCalled = false;
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { body = value; },
  };
  await middleware({ url, method }, response, () => { nextCalled = true; });
  return { response, headers, body, nextCalled };
}

describe('media redesign bundled-preview middleware', () => {
  it('authorizes the reviewed audio fixture alongside the existing virtual video fixtures', () => {
    expect(BRANCH_ALLOWED_TITLES).toContain('584614');
  });

  it('requires the caller to pin the accepted SHA rather than trusting a source constant', () => {
    expect(() => requireExpectedSha()).toThrow('MEDIA_ACCEPTANCE_EXPECTED_SHA');
    expect(requireExpectedSha(ACCEPTED_SOURCE_SHA)).toBe(ACCEPTED_SOURCE_SHA);
  });

  it('rejects a branch checkout or product-source edits before an accepted build can start', () => {
    expect(() => validateAcceptedSnapshot({
      head: ACCEPTED_SOURCE_SHA, branch: 'feat/media-redesign', productStatus: '',
    })).toThrow('detached');
    expect(() => validateAcceptedSnapshot({
      head: ACCEPTED_SOURCE_SHA, branch: 'HEAD', productStatus: ' M frontend/src/App.jsx',
    })).toThrow('product source');
  });

  it('allocates a fresh temporary output and refuses a caller-selected build directory', () => {
    const output = resolveAcceptanceBuildOutput({});
    try {
      expect(output.startsWith(path.join(os.tmpdir(), 'daylight-media-preview-'))).toBe(true);
      expect(fs.statSync(output).isDirectory()).toBe(true);
      expect(() => resolveAcceptanceBuildOutput({ requestedDist: '/tmp/not-a-preview-output' }))
        .toThrow('must not set MEDIA_ACCEPTANCE_DIST');
    } finally {
      fs.rmdirSync(output);
    }
  });

  it('refuses preview assets whose embedded build ID and recorded accepted SHA disagree', () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-media-preview-provenance-'));
    try {
      fs.writeFileSync(path.join(output, 'index.html'), '<link href="/favicon.ico?v=0c0c37e77e66">');
      fs.writeFileSync(path.join(output, 'acceptance-preview-provenance.json'), JSON.stringify({
        schema: 'daylight.media.acceptance-preview/v1', sourceSha: ACCEPTED_SOURCE_SHA,
        buildId: 'wrong-build-id',
      }));

      expect(() => validateArtifactProvenance(output)).toThrow('build ID');
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

  it('does not return a post-hook from Vite preview registration', () => {
    const plugin = createAcceptancePreviewPlugin({
      app: () => {}, allowedTitles: new Set(['55854']), policy: 'branch',
      sourceSha: '0c0c37e77e66837efc4bd4d620f60e4d26194965', upstream: 'http://127.0.0.1:3111',
    });

    const result = plugin.configurePreviewServer({ middlewares: { use: () => 'connect-app' } });

    expect(result).toBeUndefined();
  });

  it('allows only virtual receiver media reads and rejects commands or writes', async () => {
    let composedReads = 0;
    const middleware = attach(createAcceptancePreviewPlugin({
      app: (_request, response) => { composedReads += 1; response.end('composed read'); }, allowedTitles: new Set(['55854']), policy: 'branch',
      sourceSha: '0c0c37e77e66837efc4bd4d620f60e4d26194965', upstream: 'http://127.0.0.1:3111',
      ordinaryDeviceFixture: { middleware: async () => false },
    }));

    const acceptedReads = [
      '/api/v1/queue/plex:55854',
      '/api/v1/config/player',
      '/api/v1/proxy/plex/stream/55854',
      '/api/v1/proxy/plex/library/parts/58864/1609801730/file.mp4',
      '/api/v1/proxy/plex/video/:/transcode/universal/start.m3u8',
      '/api/v1/proxy/plex/video/:/transcode/universal/session/84cc0c4c-8160-4e89-a240-26a165440d1e/base/index.m3u8',
      '/api/v1/proxy/plex/video/:/transcode/universal/session/84cc0c4c-8160-4e89-a240-26a165440d1e/base/00000.ts',
    ];
    for (const url of acceptedReads) {
      const result = await request(middleware, { url });
      expect(result.response.statusCode, url).not.toBe(403);
      expect(result.nextCalled || result.body === 'composed read', url).toBe(true);
    }
    expect(composedReads).toBe(1); // `/stream/:ratingKey` uses the established mint router.
    for (const { url, method = 'GET' } of [
      { url: '/api/v1/queue/plex:55854', method: 'POST' },
      { url: '/api/v1/proxy/plex/video/:/transcode/universal/stop?session=84cc0c4c-8160-4e89-a240-26a165440d1e' },
      { url: '/api/v1/proxy/plex/video/:/transcode/universal/start.m3u8', method: 'POST' },
      { url: '/api/v1/proxy/plex/library/parts/58864/1609801730/file.mp4', method: 'POST' },
      { url: '/api/v1/proxy/plex/library/parts/58864/1609801730/stop' },
    ]) {
      const result = await request(middleware, { url, method });
      expect(result.response.statusCode, `${method} ${url}`).toBe(403);
      expect(result.body).toBe('Acceptance blocks upstream API command or unlisted read');
    }
  });

  it('rejects an unapproved stream before it can reach an upstream proxy', async () => {
    let composedRoutesCalled = false;
    const middleware = attach(createAcceptancePreviewPlugin({
      app: () => { composedRoutesCalled = true; },
      allowedTitles: new Set(['55854']),
      policy: 'branch',
      sourceSha: '0c0c37e77e66837efc4bd4d620f60e4d26194965',
      upstream: 'http://127.0.0.1:3111',
    }));

    const result = await request(middleware, { url: '/api/v1/proxy/plex/stream/other' });

    expect(result.response.statusCode).toBe(403);
    expect(result.body).toBe('Acceptance mint restricted to authorized test titles');
    expect(composedRoutesCalled).toBe(false);
    expect(result.nextCalled).toBe(false);
  });

  it('uses the accepted source provenance and branch mint composition for an approved stream', async () => {
    let composedRoutesCalled = false;
    const middleware = attach(createAcceptancePreviewPlugin({
      app: (_request, response) => { composedRoutesCalled = true; response.end('minted'); },
      allowedTitles: new Set(['55854']),
      policy: 'branch',
      sourceSha: '0c0c37e77e66837efc4bd4d620f60e4d26194965',
      upstream: 'http://127.0.0.1:3111',
    }), 'configureServer');

    const result = await request(middleware, { url: '/api/v1/proxy/plex/stream/55854' });

    expect(composedRoutesCalled).toBe(true);
    expect(result.headers.get('x-media-acceptance-source')).toBe('accepted-0c0c37e77e66837efc4bd4d620f60e4d26194965');
    expect(result.headers.get('x-media-acceptance-mint')).toBe('worktree');
    expect(result.headers.get('x-media-acceptance-policy')).toBe('branch');
    expect(result.body).toBe('minted');
  });
});

describe('live fixture encoder', () => {
  it('answers 404 with a clear message, not a crash, when ffmpeg cannot be spawned', async () => {
    const child = new EventEmitter();
    child.kill = () => {};
    __setLiveEncoderSpawnForTests(() => {
      setTimeout(() => child.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })), 0);
      return child;
    });
    try {
      const middleware = attach(createAcceptancePreviewPlugin({
        app: (_request, response) => response.end('composed'), allowedTitles: new Set(['55854']), policy: 'branch',
        sourceSha: '0c0c37e77e66837efc4bd4d620f60e4d26194965', upstream: 'http://127.0.0.1:3111',
      }));
      // The route answers asynchronously (it polls for the first playlist),
      // so use a response that records when it ends.
      let body = null;
      const response = { statusCode: 200, setHeader() {}, end(value = '') { body = value; } };
      await middleware({ url: '/api/v1/_fixture/live/index.m3u8', method: 'GET' }, response, () => {});
      for (let i = 0; i < 80 && body === null; i += 1) await new Promise((r) => setTimeout(r, 25));
      expect(response.statusCode).toBe(404);
      expect(body).toMatch(/ffmpeg is unavailable/);
    } finally {
      __setLiveEncoderSpawnForTests();
    }
  });
});

describe('media redesign acceptance: read-only media-source check', () => {
  const sha = 'a'.repeat(40);
  const plugin = (probe) => createAcceptancePreviewPlugin({
    app: () => {}, allowedTitles: new Set(['584614']), policy: 'branch', sourceSha: sha,
    upstream: 'http://127.0.0.1:3111', ordinaryDeviceFixture: { middleware: async () => false },
    sourceProbeFetch: probe,
  });
  const post = async (probe, body) => {
    const middleware = attach(plugin(probe), 'configurePreviewServer');
    const chunks = [Buffer.from(JSON.stringify(body))];
    const req = { url: '/api/v1/media-source/check', method: 'POST', async *[Symbol.asyncIterator]() { yield* chunks; } };
    const headers = new Map();
    let out = '';
    const res = { statusCode: 200, setHeader: (k, v) => headers.set(k.toLowerCase(), v), end: (v = '') => { out = v; } };
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    return { status: res.statusCode, body: out ? JSON.parse(out) : null, nextCalled };
  };

  // The Player's refused-file wait needs an answer from /media-source/check. The
  // ordinary-journey allowlist used to 403 it, so a file Plex refused for a moment
  // (503 source-unreadable) was never waited on and the receiver gave up in seconds.
  it('answers readable when the title streams, without healing anything', async () => {
    const calls = [];
    const probe = async (url, init) => { calls.push([String(url), init?.method ?? 'GET']); return { ok: true, status: 206 }; };
    const result = await post(probe, { contentId: 'plex:584614' });
    expect(result).toMatchObject({ status: 200, body: { state: 'readable' }, nextCalled: false });
    expect(calls).toEqual([['http://127.0.0.1:3111/api/v1/proxy/plex/stream/584614', 'GET']]);
  });

  it('answers unreadable on a source-unreadable 503 so the Player waits and polls', async () => {
    const probe = async () => ({ ok: false, status: 503 });
    expect((await post(probe, { contentId: 'plex:584614' })).body).toMatchObject({ state: 'unreadable' });
  });

  it('answers unknown for anything else and refuses titles outside the allowlist', async () => {
    expect((await post(async () => { throw new Error('down'); }, { contentId: 'plex:584614' })).body).toMatchObject({ state: 'unknown' });
    const other = await post(async () => ({ ok: true, status: 206 }), { contentId: 'plex:1' });
    expect(other.status).toBe(403);
  });
});

