// Backend-free Vite config for the Skyline Invaders visual harness. Reuses the
// app's Vite config; refuses anything that would have gone to the backend.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import appConfigFn from '../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const PORT = Number(process.env.HARNESS_PORT || 5196);

function refuseBackend() {
  return {
    name: 'skyline-invaders-harness',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url.startsWith('/api/') || url.startsWith('/ws')) { res.statusCode = 404; res.end(`harness: unstubbed backend call ${url}`); return; }
        next();
      });
    },
  };
}

export default async (env = {}) => {
  const app = await appConfigFn({ mode: 'development', command: 'serve', ...env });
  return {
    root: here,
    // Keep the dep cache out of the (shared, symlinked) node_modules.
    cacheDir: process.env.HARNESS_CACHE || path.join(repoRoot, 'tests/_scratch/out/.vite-skyline-invaders-harness-cache'),
    define: app.define, css: app.css,
    plugins: [...(app.plugins || []), refuseBackend()],
    resolve: {
      dedupe: app.resolve?.dedupe,
      alias: [
        { find: /^@\/lib\/logging\/Logger\.js$/, replacement: path.join(here, 'stubs/logger.js') },
        ...Object.entries(app.resolve?.alias || {}).map(([find, replacement]) => ({ find, replacement })),
      ],
    },
    server: { host: '127.0.0.1', port: PORT, strictPort: true, fs: { strict: false }, watch: { ignored: ['**/node_modules/**', '**/.git/**', '**/data/**', '**/tests/_scratch/out/**'] } },
    optimizeDeps: { entries: [path.join(here, 'index.html')] },
  };
};
