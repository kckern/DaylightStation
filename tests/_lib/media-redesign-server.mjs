/**
 * Explicit, foreground acceptance server: branch frontend + branch Plex mint
 * composition, with existing upstream catalog/proxy/WebSocket services.
 * Does not bootstrap application jobs or change production configuration.
 * No Plex credential is loaded: the existing Plex passthrough supplies auth.
 */
import express from 'express';
import { createServer } from 'vite';
import { getAppPort } from './configHelper.mjs';
import { PlexAdapter } from '../../backend/src/1_adapters/content/media/plex/PlexAdapter.mjs';
import { HttpClient } from '../../backend/src/0_system/services/HttpClient.mjs';
import { createLogger } from '../../backend/src/0_system/logging/logger.mjs';
import { RegistryPlaybackStreamGateway } from '../../backend/src/1_adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { MintPlaybackStream } from '../../backend/src/3_applications/proxy/MintPlaybackStream.mjs';
import { createProxyRouter } from '../../backend/src/4_api/v1/routers/proxy.mjs';

const upstream = `http://127.0.0.1:${getAppPort()}`;
const logger = createLogger({ app: 'media-redesign-acceptance' });
const policy = process.env.MEDIA_ACCEPTANCE_POLICY || 'branch';
if (!['branch', 'copy-675677'].includes(policy)) throw new Error('Unknown acceptance policy');
class AuthenticatedProxyHttpClient extends HttpClient {
  async get(url, options) {
    // The branch adapter appends an empty token when no local credential is
    // configured. Omit only that empty value so the authenticated upstream
    // proxy can supply its token, rather than forwarding an explicit blank.
    const destination = new URL(url);
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
const Adapter = policy === 'copy-675677' ? CopyControlAdapter : PlexAdapter;
const adapter = new Adapter({
  host: `${upstream}/api/v1/proxy/plex`,
  proxyPath: '/api/v1/proxy/plex',
  logger,
}, { httpClient: new AuthenticatedProxyHttpClient({ logger }), logger });
const gateway = new RegistryPlaybackStreamGateway({
  registry: new Map([['plex', adapter]]), logger,
});
const app = express();
app.use('/api/v1/proxy', createProxyRouter({
  mintPlaybackStream: new MintPlaybackStream({ gateway }), logger,
}));
// The 60fps benchmark is a verified Game Cycling catalog asset, exercised
// only in a virtual browser, never on the configured garage screen.
const allowedTitles = new Set(policy === 'copy-675677' ? ['675677'] : ['55854', '697368', '675677']);
const server = await createServer({
  root: 'frontend',
  configFile: 'frontend/vite.config.js',
  plugins: [{
    name: 'media-redesign-branch-mint',
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        const path = new URL(req.url, upstream).pathname;
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
    },
  }],
  server: {
    // Parallel workers may save unrelated files during a journey. Tests load
    // current source on navigation, but an HMR remount must not masquerade as
    // a user-visible state-loss defect in the middle of ordinary interaction.
    host: '127.0.0.1', port: 0, strictPort: false, hmr: false,
    proxy: {
      '/api': upstream,
      '/ws': { target: upstream.replace('http:', 'ws:'), ws: true },
      '/media': undefined,
    },
  },
});
await server.listen();
logger.info('acceptance.server.ready', { urls: server.resolvedUrls.local, policy });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
