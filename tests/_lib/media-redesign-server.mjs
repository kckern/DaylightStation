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
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getAppPort } from './configHelper.mjs';
import { PlexAdapter } from '../../backend/src/1_adapters/content/media/plex/PlexAdapter.mjs';
import { HttpClient } from '../../backend/src/0_system/services/HttpClient.mjs';
import { createLogger } from '../../backend/src/0_system/logging/logger.mjs';
import { RegistryPlaybackStreamGateway } from '../../backend/src/1_adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { MintPlaybackStream } from '../../backend/src/3_applications/proxy/MintPlaybackStream.mjs';
import { createProxyRouter } from '../../backend/src/4_api/v1/routers/proxy.mjs';
import { createContentRouter } from '../../backend/src/4_api/v1/routers/content.mjs';
import { ContentQueryService } from '../../backend/src/3_applications/content/ContentQueryService.mjs';
import { createPlayRouter } from '../../backend/src/4_api/v1/routers/play.mjs';
import { createAcceptancePlaybackRead } from './media-redesign-playback-read.mjs';
import { createMediaOrdinaryDeviceFixture } from './media-ordinary-device-fixture.mjs';
import { createAllowlistedCatalog, seedAllowlist } from './media-household-fixture.mjs';
import { RegistryContentCatalogGateway } from '../../backend/src/1_adapters/content/RegistryContentCatalogGateway.mjs';

const upstream = `http://127.0.0.1:${getAppPort()}`;
const logger = createLogger({ app: 'media-redesign-acceptance' });
const policy = process.env.MEDIA_ACCEPTANCE_POLICY || 'branch';
if (!['branch', 'copy-675677', 'dash-720p-4mbps-675677', 'hls-copy-55854'].includes(policy)) throw new Error('Unknown acceptance policy');
export const ACCEPTED_SOURCE_SHA = '0c0c37e77e66837efc4bd4d620f60e4d26194965';
const PROVENANCE_FILE = 'acceptance-preview-provenance.json';
const ORDINARY_READ_PATHS = [
  /^\/api\/v1\/media\/config$/, /^\/api\/v1\/content\/query\/search(?:\/stream)?$/,
  /^\/api\/v1\/(?:list|info|siblings)\//, /^\/api\/v1\/screens\/living-room$/,
  /^\/api\/v1\/config\/player$/, /^\/api\/v1\/queue\/(?:plex:|plex\/)\d+$/,
  /^\/api\/v1\/play\//, /^\/api\/v1\/proxy\/plex\/stream\/\d+$/,
  // Item pictures (read-only images): the seeded household's tiles show real covers.
  /^\/api\/v1\/display\/plex\/\d+$/,
  /^\/api\/v1\/proxy\/plex\/library\/metadata\/\d+\/thumb(?:\/\d+)?$/,
  /^\/api\/v1\/proxy\/plex\/library\/parts\/\d+\/\d+\/file\.(?:mp4|mkv|m4v|mp3|flac|m4a|aac|ogg|wav)$/,
  // Plex start manifests and their session-scoped playlists/fragments are
  // browser media reads. Keep control endpoints (notably `stop`) outside this
  // allowlist even when callers use GET for them.
  /^\/api\/v1\/proxy\/plex\/video\/:\/transcode\/universal\/start\.(?:mpd|m3u8)$/,
  // Public-domain paintings for the slideshow fixture (music behind, RQ-PLAY-12).
  /^\/api\/v1\/static\/img\/art\/classic\/[^/]+\/[^/]+\.jpg$/,
  /^\/api\/v1\/proxy\/plex\/video\/:\/transcode\/universal\/session\/[0-9a-f-]{36}\/base\/[^/]+\.(?:m3u8|m4s|mp4|ts)$/,
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
// 266151/266152: two adjacent short episodes (Bluey S1E2/E3) for the screen
// next-episode countdown and end-of-queue journeys.
// 665638/665639: two adjacent episodes of one show with many subtitle streams
// (3 Body Problem S1E1/E2) for the subtitles/audio language journey;
// 703558: a film with three audio languages (French, Turkish, English).
export const BRANCH_ALLOWED_TITLES = ['55854', '697368', '675677', '584614', '266151', '266152', '665638', '665639', '703558'];

// A photo slideshow for the music-behind journey (RQ-PLAY-12): three
// public-domain paintings from the household art collection, served as an
// ordinary queue of `image` items. Read-only; no personal photos.
const SLIDESHOW_ART = [
  'Adolphe Schreyer - 1880 - Man with Lance Riding through the Snow/Man with Lance Riding through the Snow.jpg',
  'Adriaen van de Velde - 1664 - Pastoral Landscape with Ruins/Pastoral Landscape with Ruins.jpg',
  'Agostino Brunias - 1770 - View on the River Roseau Dominica/View on the River Roseau Dominica.jpg',
];
export function slideshowFixtureItem(index) {
  const file = SLIDESHOW_ART[index];
  if (!file) return null;
  const [folder] = file.split('/');
  return {
    id: `fixture:art-${index + 1}`, contentId: `fixture:art-${index + 1}`, assetId: `fixture:art-${index + 1}`,
    title: folder.split(' - ').at(-1), mediaType: 'image', format: 'image',
    mediaUrl: `/api/v1/static/img/art/classic/${file.split('/').map(encodeURIComponent).join('/')}`,
    slideshow: { duration: 20, effect: 'none', zoom: 1 },
  };
}
// A camera for the Show-here rule (FIND.8b/AC3): a still snapshot (another public-domain painting) that
// a "camera" result presents. Read-only; the snapshot is an ordinary image play descriptor.
export const CAMERA_FIXTURE_ID = 'fixture:cam-1';
export function cameraFixtureItem() {
  const art = slideshowFixtureItem(1);
  return { ...art, id: CAMERA_FIXTURE_ID, contentId: CAMERA_FIXTURE_ID, assetId: CAMERA_FIXTURE_ID, title: 'Acceptance camera', slideshow: undefined };
}
function serveSlideshowFixture(rawPath, res) {
  let path = rawPath;
  try { path = decodeURIComponent(rawPath); } catch { /* keep raw */ }
  if (path === `/api/v1/play/${CAMERA_FIXTURE_ID}`) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(cameraFixtureItem()));
    return true;
  }
  if (path === '/api/v1/queue/fixture:slideshow') {
    const items = SLIDESHOW_ART.map((_f, i) => slideshowFixtureItem(i));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ source: 'fixture', id: 'fixture:slideshow', count: items.length, totalDuration: 0, items }));
    return true;
  }
  const match = /^\/api\/v1\/play\/fixture:art-(\d)$/.exec(path);
  if (match) {
    const item = slideshowFixtureItem(Number(match[1]) - 1);
    res.statusCode = item ? 200 : 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(item ?? { error: 'not found' }));
    return true;
  }
  return false;
}
// A live channel for the Go to live journey (STEER.4a/AC3): a real sliding-
// window HLS live stream (test picture and tone) that one ffmpeg process,
// started on first request and owned by this server, writes in real time.
// Read-only, no household data; `isLive` rides the play descriptor exactly as
// a real live source's would. The window slides while a player is paused, so
// a paused viewer genuinely falls behind the live edge.
export const LIVE_FIXTURE_ID = 'fixture:live';
const LIVE_HLS_PREFIX = '/api/v1/_fixture/live/';
export function liveFixtureDescriptor() {
  return {
    id: LIVE_FIXTURE_ID, contentId: LIVE_FIXTURE_ID, assetId: LIVE_FIXTURE_ID,
    title: 'Acceptance live channel', mediaType: 'hls_video', format: 'hls_video', isLive: true,
    mediaUrl: `${LIVE_HLS_PREFIX}index.m3u8`,
  };
}
let liveEncoder = null;
let liveEncoderSpawn = spawn;
// Test seam: replace the spawn used for the live encoder (and forget any
// running one) so a host without ffmpeg can be simulated.
export function __setLiveEncoderSpawnForTests(spawnFn = spawn) {
  liveEncoder?.stop?.();
  liveEncoder = null;
  liveEncoderSpawn = spawnFn;
}
function ensureLiveEncoder() {
  if (liveEncoder) return liveEncoder;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-live-fixture-'));
  const child = liveEncoderSpawn('ffmpeg', ['-loglevel', 'error', '-re',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '48k',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
    '-hls_segment_filename', path.join(dir, 'seg%d.ts'), path.join(dir, 'index.m3u8')], { stdio: 'ignore' });
  const stop = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  const record = { child, dir, stop, error: null };
  child.on('exit', () => { if (liveEncoder === record) liveEncoder = null; });
  // A host without ffmpeg emits 'error' (ENOENT) on the child; unhandled it
  // would crash the whole preview server. Keep the record so the live fixture
  // route can answer with a clear message instead of polling for a playlist.
  child.on('error', (error) => {
    record.error = `ffmpeg is unavailable on this host (${error?.code ?? error?.message ?? 'spawn failed'}); the live fixture cannot run`;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  liveEncoder = record;
  return liveEncoder;
}
function serveLiveFixture(rawPath, req, res) {
  let path_ = rawPath;
  try { path_ = decodeURIComponent(rawPath); } catch { /* keep raw */ }
  if (path_ === `/api/v1/play/${LIVE_FIXTURE_ID}`) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(liveFixtureDescriptor()));
    return true;
  }
  if (path_ === `/api/v1/queue/${LIVE_FIXTURE_ID}`) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ source: 'fixture', id: LIVE_FIXTURE_ID, count: 1, totalDuration: 0, items: [liveFixtureDescriptor()] }));
    return true;
  }
  if (path_.startsWith(LIVE_HLS_PREFIX)) {
    const name = path_.slice(LIVE_HLS_PREFIX.length);
    if (!/^(?:index\.m3u8|seg\d+\.ts)$/.test(name)) { res.statusCode = 404; res.end('not found'); return true; }
    const encoder = ensureLiveEncoder();
    const { dir } = encoder;
    const file = path.join(dir, name);
    const send = (attempt = 0) => {
      if (encoder.error) {
        res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end(encoder.error);
        return;
      }
      if (fs.existsSync(file)) {
        res.setHeader('Content-Type', name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
        res.setHeader('Cache-Control', 'no-store');
        try { res.end(fs.readFileSync(file)); } catch { res.statusCode = 404; res.end('gone'); }
        return;
      }
      // The first playlist appears a few seconds after the encoder starts.
      if (attempt < 40 && name === 'index.m3u8') { setTimeout(() => send(attempt + 1), attempt === 0 ? 50 : 500); return; }
      res.statusCode = 404; res.end('not found');
    };
    send();
    return true;
  }
  return false;
}
// A single photo as a search result (FIND.8b/AC3: a tap shows it on the device
// in hand; "Show on…" sends it elsewhere). Typing "acceptance photo" answers
// with the slideshow fixture's first public-domain painting as a leaf photo,
// through the same SSE shape the real search stream uses. Nothing else about
// search changes.
function serveFixturePhotoSearch(rawUrl, res) {
  const url = new URL(rawUrl, 'http://fixture.invalid');
  if (url.pathname !== '/api/v1/content/query/search/stream') return false;
  const text = url.searchParams.get('text') ?? '';
  const camera = /acceptance camera/i.test(text);
  if (!camera && !/acceptance photo/i.test(text)) return false;
  const art = slideshowFixtureItem(0);
  const cam = cameraFixtureItem();
  const item = camera
    ? { id: cam.id, source: 'fixture', localId: 'cam-1', title: cam.title, type: 'camera', thumbnail: cam.mediaUrl, metadata: { type: 'camera' }, score: 100 }
    : { id: art.id, source: 'fixture', localId: 'art-1', title: `Acceptance photo: ${art.title}`,
      type: 'photo', mediaType: 'image', thumbnail: art.mediaUrl, metadata: { type: 'photo' }, score: 100 };
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write(`data: ${JSON.stringify({ event: 'pending', sources: ['fixture'], intent: null })}\n\n`);
  res.write(`data: ${JSON.stringify({ event: 'results', source: 'fixture', items: [item], pending: [] })}\n\n`);
  res.end(`data: ${JSON.stringify({ event: 'complete', totalMs: 1 })}\n\n`);
  return true;
}
// An id typed for a source that does not exist (`plex-main:12345`) is answered
// by THIS branch's real content search router and query service, because the
// upstream household backend predates that rule. Everything else about search
// stays the household's real answer. The set of real source names is read once
// from the upstream's own search stream (its first `pending` event).
const SEARCH_PATHS = new Set(['/api/v1/content/query/search', '/api/v1/content/query/search/stream']);
let upstreamSources = null;
async function readUpstreamSources() {
  if (upstreamSources) return upstreamSources;
  try {
    const response = await fetch(`${upstream}/api/v1/content/query/search/stream?text=zz`, { headers: { Accept: 'text/event-stream' } });
    const reader = response.body.getReader();
    let text = '';
    for (let i = 0; i < 20 && !/\n\n/.test(text); i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('utf8');
    }
    await reader.cancel().catch(() => {});
    upstreamSources = new Set(JSON.parse(/data: (.*)/.exec(text)[1]).sources);
  } catch { upstreamSources = new Set(); }
  return upstreamSources;
}
const branchSearchApp = express();
branchSearchApp.use('/api/v1/content', createContentRouter({
  contentQueryService: new ContentQueryService({
    contentCatalog: new RegistryContentCatalogGateway({ registry: new Map([['plex', adapter]]), logger }), logger,
  }),
  logger,
}));
async function isIdForUnknownSource(req, path) {
  if (req.method !== 'GET' || !SEARCH_PATHS.has(path)) return false;
  const text = new URL(req.url, upstream).searchParams.get('text') ?? '';
  const match = /^([\w-]+):(\S+)$/.exec(text);
  if (!match || !/[-_]/.test(match[1]) || !(/^\d+$/.test(match[2]) || match[2].includes('/'))) return false;
  return !(await readUpstreamSources()).has(match[1].toLowerCase()) && upstreamSources.size > 0;
}
const allowedTitles = new Set(policy === 'branch' ? BRANCH_ALLOWED_TITLES
  : policy === 'hls-copy-55854' ? ['55854'] : ['675677']);

/**
 * Shared by Vite dev and Vite preview: production-built assets retain the
 * exact branch mint/read composition rather than introducing another proxy.
 */
/**
 * The Player's answer to "the media server refused this file" is to ask
 * POST /api/v1/media-source/check and WAIT while the file is `unreadable`
 * (docs/reference/player/media-source-healing.md). The ordinary-journey
 * allowlist forbids upstream POSTs, so the check was answered 403 and the
 * receiver fell back to its short recovery ladder: a title Plex refused for
 * three seconds (NFS `Permission denied (13)`) failed the journey instead of
 * being waited on. This answers the check read-only: it only tries to stream
 * the allowlisted title and never asks the real healer to chmod anything.
 */
async function answerMediaSourceCheck(req, res, { allowedTitles, upstream, probeFetch }) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let contentId = null;
  try { contentId = JSON.parse(raw || '{}')?.contentId ?? null; } catch { contentId = null; }
  const ratingKey = /^plex:(\d+)$/.exec(String(contentId || ''))?.[1];
  res.setHeader('Content-Type', 'application/json');
  if (!ratingKey || !allowedTitles.has(ratingKey)) {
    res.statusCode = 403;
    return res.end(JSON.stringify({ error: 'Acceptance source check restricted to authorized test titles' }));
  }
  let state = 'unknown';
  try {
    const response = await probeFetch(new URL(`/api/v1/proxy/plex/stream/${ratingKey}`, upstream).toString(),
      { headers: { Range: 'bytes=0-0' } });
    if (response.ok) state = 'readable';
    else if (response.status === 503) state = 'unreadable';
  } catch { state = 'unknown'; }
  res.statusCode = 200;
  return res.end(JSON.stringify({ state, reason: 'acceptance-read-only-probe', steps: [] }));
}

export function createAcceptancePreviewPlugin({ app, allowedTitles, policy, sourceSha, upstream, ordinaryDeviceFixture = null, sourceProbeFetch = globalThis.fetch }) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha || '')) throw new Error('Bundled preview source must be a full SHA');
  const acceptanceSource = `accepted-${sourceSha}`;
  const install = vite => {
    vite.middlewares.use(async (req, res, next) => {
    res.setHeader('X-Media-Acceptance-Source', acceptanceSource);
    if (ordinaryDeviceFixture && await ordinaryDeviceFixture.middleware(req, res)) return;
    const path = new URL(req.url, upstream).pathname;
    if (req.method === 'POST' && path === '/api/v1/media-source/check') {
      return answerMediaSourceCheck(req, res, { allowedTitles, upstream, probeFetch: sourceProbeFetch });
    }
    if (req.method === 'GET' && serveSlideshowFixture(path, res)) return;
    if (req.method === 'GET' && serveLiveFixture(path, req, res)) return;
    if (req.method === 'GET' && serveFixturePhotoSearch(req.url, res)) return;
    if (await isIdForUnknownSource(req, path)) { res.setHeader('X-Media-Acceptance-Read', 'worktree-search'); return branchSearchApp(req, res, next); }
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
    // frontend/vite.config.js proxies /ws to the household dev backend. In
    // the acceptance dev server /ws belongs to the fixture-local EventBus;
    // leaving that proxy in place made it answer every screen socket upgrade
    // with a refused backend connection, so no screen ever subscribed.
    config(userConfig) {
      if (userConfig?.server?.proxy && '/ws' in userConfig.server.proxy) delete userConfig.server.proxy['/ws'];
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
  // The household routes run the REAL household services over a seeded temp
  // data dir. Catalog describe calls reach the real upstream through the same
  // adapter as playback, confined to the acceptance allowlist.
  const catalog = createAllowlistedCatalog(
    new RegistryContentCatalogGateway({ registry: new Map([['plex', adapter]]), logger }),
    seedAllowlist([...allowedTitles].map(id => `plex:${id}`)),
  );
  const ordinaryDeviceFixture = createMediaOrdinaryDeviceFixture({ upstream, logger, catalog });
  const plugin = createAcceptancePreviewPlugin({ app, allowedTitles, policy, sourceSha, upstream, ordinaryDeviceFixture });
  const shared = {
    root: 'frontend', configFile: 'frontend/vite.config.js', plugins: [plugin],
    // Worktrees symlink frontend/node_modules to the main checkout, so the
    // default dep-optimizer cache is shared by every concurrent dev server and
    // they re-optimize (and reload the page) under each other. A worktree run
    // can point at its own cache directory.
    ...(process.env.MEDIA_ACCEPTANCE_VITE_CACHE_DIR ? { cacheDir: process.env.MEDIA_ACCEPTANCE_VITE_CACHE_DIR } : {}),
  };
  const server = dist ? await preview({ ...shared, build: { outDir: dist }, preview: {
    host: '127.0.0.1', port: 0, strictPort: false, headers: {
      'X-Media-Acceptance-Source': `accepted-${sourceSha}`,
    }, proxy: { '/api': upstream },
  } }) : await createServer({ ...shared, server: {
    // Parallel workers may save unrelated files during a journey. Tests load
    // current source on navigation, but an HMR remount must not masquerade as
    // a user-visible state-loss defect in the middle of ordinary interaction.
    // `ws: false` too: with only `hmr: false` the Vite client still opens its
    // socket, the fixture EventBus answers that upgrade, the client sees a
    // bad frame, decides the server restarted and reloads the page forever.
    host: '127.0.0.1', port: 0, strictPort: false, hmr: false, ws: false,
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
