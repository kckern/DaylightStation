import { describe, expect, it } from 'vitest';
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
