/**
 * Explicit, foreground acceptance server: branch frontend + branch Plex mint
 * composition, with existing upstream catalog/proxy/WebSocket services.
 * Does not bootstrap application jobs or change production configuration.
 * No Plex credential is loaded: the existing Plex passthrough supplies auth.
 */
import express from 'express';
import { build, createServer, preview } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getAppPort } from './configHelper.mjs';
import { PlexAdapter } from '../../backend/src/1_adapters/content/media/plex/PlexAdapter.mjs';
import { HttpClient } from '../../backend/src/0_system/services/HttpClient.mjs';
import { createLogger } from '../../backend/src/0_system/logging/logger.mjs';
import { RegistryPlaybackStreamGateway } from '../../backend/src/1_adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { MintPlaybackStream } from '../../backend/src/3_applications/proxy/MintPlaybackStream.mjs';
import { createProxyRouter } from '../../backend/src/4_api/v1/routers/proxy.mjs';
import { createPlayRouter } from '../../backend/src/4_api/v1/routers/play.mjs';
import { createAcceptancePlaybackRead } from './media-redesign-playback-read.mjs';
import { createMediaOrdinaryDeviceFixture } from './media-ordinary-device-fixture.mjs';

const upstream = `http://127.0.0.1:${getAppPort()}`;
const logger = createLogger({ app: 'media-redesign-acceptance' });
const policy = process.env.MEDIA_ACCEPTANCE_POLICY || 'branch';
if (!['branch', 'copy-675677', 'dash-720p-4mbps-675677', 'hls-copy-55854'].includes(policy)) throw new Error('Unknown acceptance policy');
export const ACCEPTED_SOURCE_SHA = '0c0c37e77e66837efc4bd4d620f60e4d26194965';
const PROVENANCE_FILE = 'acceptance-preview-provenance.json';
const ORDINARY_READ_PATHS = [
  /^\/api\/v1\/media\/config$/, /^\/api\/v1\/content\/query\/search(?:\/stream)?$/,
  /^\/api\/v1\/(?:list|info|siblings)\//, /^\/api\/v1\/screens\/living-room$/,
  /^\/api\/v1\/(?:play|proxy\/plex\/stream)\//,
];

export function requireExpectedSha(expectedSha = process.env.MEDIA_ACCEPTANCE_EXPECTED_SHA) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha || '')) throw new Error('MEDIA_ACCEPTANCE_EXPECTED_SHA must be an explicit full SHA');
  return expectedSha;
}

export function validateAcceptedSnapshot({ head, branch, productStatus, expectedSha = ACCEPTED_SOURCE_SHA }) {
  if (head !== expectedSha) throw new Error('Acceptance build requires the expected accepted HEAD');
  if (branch !== 'HEAD') throw new Error('Acceptance build requires a detached checkout');
  if (productStatus.trim()) throw new Error('Acceptance build requires clean product source');
  return { head, branch };
}

export function readAcceptedSnapshot({ cwd = process.cwd(), exec = execFileSync, expectedSha = ACCEPTED_SOURCE_SHA } = {}) {
  const runGit = args => exec('git', args, { cwd, encoding: 'utf8' }).trim();
  return validateAcceptedSnapshot({
    head: runGit(['rev-parse', 'HEAD']), expectedSha,
    branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
    productStatus: runGit(['status', '--porcelain', '--', 'frontend', 'backend', 'shared']),
  });
}

export function resolveAcceptanceBuildOutput({ requestedDist } = {}) {
  if (requestedDist) throw new Error('Build must not set MEDIA_ACCEPTANCE_DIST');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-media-preview-'));
}

export function writeArtifactProvenance(dist, sourceSha = ACCEPTED_SOURCE_SHA) {
  const provenance = {
    schema: 'daylight.media.acceptance-preview/v1', sourceSha, buildId: sourceSha.slice(0, 12),
  };
  fs.writeFileSync(path.join(dist, PROVENANCE_FILE), `${JSON.stringify(provenance)}\n`, 'utf8');
  return provenance;
}

export function validateArtifactProvenance(dist, expectedSha = ACCEPTED_SOURCE_SHA) {
  let provenance;
  try {
    provenance = JSON.parse(fs.readFileSync(path.join(dist, PROVENANCE_FILE), 'utf8'));
  } catch { throw new Error('Preview artifact lacks accepted provenance'); }
  const expectedBuildId = expectedSha.slice(0, 12);
  if (provenance.schema !== 'daylight.media.acceptance-preview/v1'
    || provenance.sourceSha !== expectedSha) throw new Error('Preview artifact does not name the expected accepted SHA');
  if (provenance.buildId !== expectedBuildId) throw new Error('Preview artifact build ID does not match the expected accepted SHA');
  const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  if (!index.includes(`v=${expectedBuildId}`)) throw new Error('Preview artifact index build ID does not match provenance');
  return provenance;
}
class AuthenticatedProxyHttpClient extends HttpClient {
  async get(url, options) {
    // The branch adapter appends an empty token when no local credential is
    // configured. Omit only that empty value so the authenticated upstream
    // proxy can supply its token, rather than forwarding an explicit blank.
    const destination = new URL(url);
    if (policy === 'hls-copy-55854' && destination.pathname.endsWith('/video/:/transcode/universal/decision')) {
      const profile = destination.searchParams.get('X-Plex-Client-Profile-Extra');
      if (profile) destination.searchParams.set('X-Plex-Client-Profile-Extra', profile.replaceAll('protocol=dash', 'protocol=hls'));
    }
    if (destination.searchParams.get('X-Plex-Token') === '') {
      destination.searchParams.delete('X-Plex-Token');
    }
    const response = await super.get(destination.toString(), options);
    if (destination.pathname.endsWith('/video/:/transcode/universal/decision')) {
      const streams = [];
      const collect = value => {
        if (!value || typeof value !== 'object') return;
        if (value.streamType && value.codec) streams.push({
          streamType: value.streamType, codec: value.codec, decision: value.decision,
        });
        for (const nested of Object.values(value)) collect(nested);
      };
      collect(response.data);
      logger.info('acceptance.encoder-decision', { policy, streams });
    }
    return response;
  }
}
// Controlled comparison only: use existing URL builders, on one verified
// virtual asset, without editing or deploying production adapter policy.
class CopyControlAdapter extends PlexAdapter {
  requestTranscodeDecision(key, options) {
    if (String(key) !== '675677') throw new Error('Copy control restricted to benchmark');
    return super.requestTranscodeDecision(key, { ...options, allowDirectPlay: false, allowDirectStream: true });
  }
  _buildTranscodeUrl(key, client, session, bitrate, resolution, offset, _allow, downmix) {
    if (String(key) !== '675677') throw new Error('Copy control restricted to benchmark');
    return super._buildTranscodeUrl(key, client, session, bitrate, resolution, offset, true, downmix);
  }
}
class LowerBitrateControlAdapter extends PlexAdapter {
  requestTranscodeDecision(key, options) {
    if (String(key) !== '675677') throw new Error('Lower-bitrate control restricted to benchmark');
    return super.requestTranscodeDecision(key, { ...options, allowDirectPlay: false,
      allowDirectStream: false, maxVideoBitrate: 4000, maxResolution: '720' });
  }
  _buildTranscodeUrl(key, client, session, _bitrate, _resolution, offset, _copy, downmix) {
    if (String(key) !== '675677') throw new Error('Lower-bitrate control restricted to benchmark');
    return super._buildTranscodeUrl(key, client, session, 4000, '720', offset, false, downmix);
  }
}
class HlsCopyControlAdapter extends PlexAdapter {
  requestTranscodeDecision(key, options) {
    if (String(key) !== '55854') throw new Error('HLS control restricted to Arrival');
    return super.requestTranscodeDecision(key, { ...options, allowDirectPlay: false, allowDirectStream: true });
  }
  _buildTranscodeUrl(key, client, session, bitrate, resolution, offset, _copy, downmix) {
    if (String(key) !== '55854') throw new Error('HLS control restricted to Arrival');
    const url = new URL(super._buildTranscodeUrl(key, client, session, bitrate, resolution, offset, true, downmix), upstream);
    url.pathname = url.pathname.replace(/start\.mpd$/, 'start.m3u8');
    const profile = url.searchParams.get('X-Plex-Client-Profile-Extra');
    if (profile) url.searchParams.set('X-Plex-Client-Profile-Extra', profile.replaceAll('protocol=dash', 'protocol=hls'));
    return url.pathname + url.search;
  }
}
const Adapter = policy === 'copy-675677' ? CopyControlAdapter
  : policy === 'dash-720p-4mbps-675677' ? LowerBitrateControlAdapter
    : policy === 'hls-copy-55854' ? HlsCopyControlAdapter : PlexAdapter;
const adapter = new Adapter({
  host: `${upstream}/api/v1/proxy/plex`,
  proxyPath: '/api/v1/proxy/plex',
  logger,
  ...(policy === 'branch' ? {} : { protocol: policy === 'hls-copy-55854' ? 'hls' : 'dash' }),
}, { httpClient: new AuthenticatedProxyHttpClient({ logger }), logger });
const gateway = new RegistryPlaybackStreamGateway({
  registry: new Map([['plex', adapter]]), logger,
});
const app = express();
app.use('/api/v1/proxy', createProxyRouter({
  mintPlaybackStream: new MintPlaybackStream({ gateway }), logger,
}));
app.use('/api/v1/play', createPlayRouter({
  playbackReadService: createAcceptancePlaybackRead({ adapter, upstream, logger }), logger,
}));
// The 60fps benchmark is a verified Game Cycling catalog asset, exercised
// only in a virtual browser, never on the configured garage screen.
// Read-only virtual-browser fixtures. The audio track is pinned by rating key
// as well as its runtime test selector; titles alone are not stable identity.
export const BRANCH_ALLOWED_TITLES = ['55854', '697368', '675677', '584614'];
const allowedTitles = new Set(policy === 'branch' ? BRANCH_ALLOWED_TITLES
  : policy === 'hls-copy-55854' ? ['55854'] : ['675677']);

/**
 * Shared by Vite dev and Vite preview: production-built assets retain the
 * exact branch mint/read composition rather than introducing another proxy.
 */
export function createAcceptancePreviewPlugin({ app, allowedTitles, policy, sourceSha, upstream, ordinaryDeviceFixture = null }) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha || '')) throw new Error('Bundled preview source must be a full SHA');
  const acceptanceSource = `accepted-${sourceSha}`;
  const install = vite => {
    vite.middlewares.use(async (req, res, next) => {
    res.setHeader('X-Media-Acceptance-Source', acceptanceSource);
    if (ordinaryDeviceFixture && await ordinaryDeviceFixture.middleware(req, res)) return;
    const path = new URL(req.url, upstream).pathname;
    // The ordinary journey gets only catalog/config/media reads. This also
    // blocks GET-shaped command routes outside `/device` (which the fixture
    // consumes separately) rather than trusting HTTP method alone.
    if (ordinaryDeviceFixture && path.startsWith('/api/')
      && (req.method !== 'GET' || !ORDINARY_READ_PATHS.some(pattern => pattern.test(path)))) {
      res.statusCode = 403;
      return res.end('Acceptance blocks upstream API command or unlisted read');
    }
    const playMatch = /^\/api\/v1\/play\/(?:plex:|plex\/)\d+$/.test(path);
    if (policy === 'branch' && playMatch) {
      const ratingKey = path.split(/[:/]/).at(-1);
      if (req.method !== 'GET' || !allowedTitles.has(ratingKey)) {
        res.statusCode = 403;
        return res.end('Acceptance play read restricted to authorized test titles');
      }
      res.setHeader('X-Media-Acceptance-Read', 'worktree');
      return app(req, res, next);
    }
    if (policy === 'hls-copy-55854' && /^\/api\/v1\/play\/(?:plex:|plex\/)55854$/.test(path)) {
      if (req.method !== 'GET') { res.statusCode = 403; return res.end('GET only'); }
      try {
        const url = new URL(req.url, upstream);
        // Existing API option supplies real from-beginning metadata and
        // stream offset; no synthetic position/resume data is injected.
        url.searchParams.set('resume', 'false');
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        res.setHeader('X-Media-Acceptance-Policy', policy);
        if (!response.ok) return res.end(await response.text());
        const body = await response.json();
        return res.end(JSON.stringify({ ...body, mediaType: 'hls_video', format: 'hls_video' }));
      } catch { res.statusCode = 502; return res.end('HLS control upstream request failed'); }
    }
    const match = /^\/api\/v1\/proxy\/plex\/stream\/([^/]+)$/.exec(path);
    if (!match) return next();
    if (req.method !== 'GET' || !allowedTitles.has(match[1])) {
      res.statusCode = 403;
      return res.end('Acceptance mint restricted to authorized test titles');
    }
    res.setHeader('X-Media-Acceptance-Mint', 'worktree');
    res.setHeader('X-Media-Acceptance-Policy', policy);
    return app(req, res, next);
    });
  };

  return {
    name: 'media-redesign-branch-mint',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/VideoPlayer.jsx')) return null;
      const anchor = 'hls = new Hls({ enableWorker: true, ...(isPlex ? { startPosition: 0 } : {}) });';
      if (!code.includes(anchor)) throw new Error('HLS observation anchor changed');
      const observation = `
        for (const kind of ['INIT_PTS_FOUND', 'FRAG_BUFFERED']) {
          hls.on(Hls.Events[kind], (_event, data) => {
            const rows = window.__hlsAcceptance ??= [];
            rows.push({ kind, initPTS: data.initPTS, timescale: data.timescale,
              sn: data.frag?.sn, start: data.frag?.start,
              startPTS: data.frag?.startPTS, endPTS: data.frag?.endPTS, duration: data.frag?.duration });
            if (rows.length > 512) rows.shift();
          });
        }
      `;
      // Read-only timestamp evidence; engine selection is production code.
      return { code: code.replace(anchor, anchor + observation), map: null };
    },
    configureServer: install,
    configurePreviewServer: install,
  };
}

const viteProxy = {
  '/api': upstream,
  '/ws': { target: upstream.replace('http:', 'ws:'), ws: true },
};

export async function runAcceptanceServer() {
  const dist = process.env.MEDIA_ACCEPTANCE_DIST;
  if (process.argv.includes('--build')) {
    const expectedSha = requireExpectedSha();
    const snapshot = readAcceptedSnapshot({ expectedSha });
    const output = resolveAcceptanceBuildOutput({ requestedDist: dist });
    const sourceSha = snapshot.head;
    process.env.COMMIT_HASH = sourceSha;
    const plugin = createAcceptancePreviewPlugin({ app, allowedTitles, policy, sourceSha, upstream });
    await build({ root: 'frontend', configFile: 'frontend/vite.config.js', plugins: [plugin],
      build: { outDir: output, emptyOutDir: false } });
    writeArtifactProvenance(output, sourceSha);
    validateArtifactProvenance(output, sourceSha);
    logger.info('acceptance.preview.built', { dist: output, sourceSha, policy });
    return;
  }
  let sourceSha = process.env.MEDIA_ACCEPTANCE_SOURCE_SHA || ACCEPTED_SOURCE_SHA;
  if (dist) {
    const expectedSha = requireExpectedSha();
    const snapshot = readAcceptedSnapshot({ expectedSha });
    sourceSha = snapshot.head;
    validateArtifactProvenance(dist, sourceSha);
  }
  process.env.COMMIT_HASH = sourceSha;
  const ordinaryDeviceFixture = createMediaOrdinaryDeviceFixture({ upstream, logger });
  const plugin = createAcceptancePreviewPlugin({ app, allowedTitles, policy, sourceSha, upstream, ordinaryDeviceFixture });
  const shared = {
    root: 'frontend', configFile: 'frontend/vite.config.js', plugins: [plugin],
  };
  const server = dist ? await preview({ ...shared, build: { outDir: dist }, preview: {
    host: '127.0.0.1', port: 0, strictPort: false, headers: {
      'X-Media-Acceptance-Source': `accepted-${sourceSha}`,
    }, proxy: { '/api': upstream },
  } }) : await createServer({ ...shared, server: {
    // Parallel workers may save unrelated files during a journey. Tests load
    // current source on navigation, but an HMR remount must not masquerade as
    // a user-visible state-loss defect in the middle of ordinary interaction.
    host: '127.0.0.1', port: 0, strictPort: false, hmr: false,
    // /ws belongs to the fixture-local EventBus below. Do not proxy it to
    // the household server: that would make the virtual screen claim a real
    // device route and defeat the acceptance boundary.
    proxy: { '/api': upstream },
  } });
  await ordinaryDeviceFixture.attach(server.httpServer);
  if (!dist) await server.listen();
  logger.info('acceptance.server.ready', { urls: server.resolvedUrls?.local, policy, sourceSha, mode: dist ? 'preview' : 'dev' });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await ordinaryDeviceFixture.stop();
      await server.close();
      process.exit(0);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runAcceptanceServer();
