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
class AuthenticatedProxyHttpClient extends HttpClient {
  get(url, options) {
    // The branch adapter appends an empty token when no local credential is
    // configured. Omit only that empty value so the authenticated upstream
    // proxy can supply its token, rather than forwarding an explicit blank.
    const destination = new URL(url);
    if (destination.searchParams.get('X-Plex-Token') === '') {
      destination.searchParams.delete('X-Plex-Token');
    }
    return super.get(destination.toString(), options);
  }
}
const adapter = new PlexAdapter({
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
const allowedTitles = new Set(['55854', '697368']);
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
        return app(req, res, next);
      });
    },
  }],
  server: {
    host: '127.0.0.1', port: 0, strictPort: false,
    proxy: {
      '/api': upstream,
      '/ws': { target: upstream.replace('http:', 'ws:'), ws: true },
      '/media': undefined,
    },
  },
});
await server.listen();
logger.info('acceptance.server.ready', { urls: server.resolvedUrls.local });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
