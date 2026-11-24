// Backend-free Vite config for the fitness player overlay harness.
// Modelled on ../cycle-game-harness/vite.harness.config.mjs: reuses the app's own
// config (plugins, scss options, aliases, define) and only overrides root, the
// logger (no WebSocket), the FitnessContext module, the governance audio loop,
// the dev-server bind, and a middleware that answers avatar URLs with SVG.
//
//   node_modules/.bin/vite --config tests/_scratch/fitness-overlay-harness/vite.harness.config.mjs
//   BASE_URL=http://127.0.0.1:5198 node tests/_scratch/shoot-fitness-overlays.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import appConfigFn from '../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const PORT = Number(process.env.HARNESS_PORT || 5198);

const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function faceSvg(id) {
  const raw = decodeURIComponent(id);
  const letter = (raw.replace(/^(user_|rider-)/, '')[0] || '?').toUpperCase();
  const h = hue(raw);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" fill="hsl(${h},45%,32%)"/>
<circle cx="50" cy="40" r="20" fill="hsl(${h},55%,72%)"/>
<path d="M14 100c2-26 18-36 36-36s34 10 36 36z" fill="hsl(${h},55%,72%)"/>
<text x="50" y="48" font-family="sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="hsl(${h},45%,20%)">${letter}</text></svg>`;
}

function harnessAssets() {
  return {
    name: 'fitness-overlay-harness-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const m = url.match(/^\/api\/v1\/static\/img\/users\/(.+)$/);
        if (m) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(faceSvg(m[1])); return; }
        if (url.startsWith('/api/') || url.startsWith('/ws') || url.startsWith('/media/')) {
          // Anything else would have gone to the backend: refuse loudly.
          res.statusCode = 404;
          res.end(`harness: unstubbed backend call ${url}`);
          return;
        }
        next();
      });
    },
  };
}

export default async (env = {}) => {
  const app = await appConfigFn({ mode: 'development', command: 'serve', ...env });
  const appAlias = app.resolve?.alias || {};
  const aliasList = [
    // Both the '@/lib/logging/...' and the relative '../frontend/src/lib/logging/...' spellings.
    { find: /^(?:.*\/)?lib\/logging\/(?:Logger|singleton)\.js$/, replacement: path.join(here, 'stubs/logger.js') },
    { find: /^(\.\.\/)+context\/FitnessContext\.jsx$/, replacement: path.join(here, 'stubs/FitnessContext.jsx') },
    { find: /^\.\/GovernanceAudioPlayer\.jsx$/, replacement: path.join(here, 'stubs/GovernanceAudioPlayer.jsx') },
    ...(Array.isArray(appAlias) ? appAlias : Object.entries(appAlias).map(([find, replacement]) => ({ find, replacement }))),
  ];
  return {
    root: here,
    // Keep the dep cache out of the (shared, symlinked) node_modules.
    cacheDir: path.join(repoRoot, 'tests/_scratch/out/.vite-overlay-harness-cache'),
    define: app.define,
    css: app.css,
    plugins: [...(app.plugins || []), harnessAssets()],
    resolve: { dedupe: app.resolve?.dedupe, alias: aliasList },
    server: {
      host: '127.0.0.1',
      port: PORT,
      strictPort: true,
      fs: { strict: false },
      watch: null,
    },
    // The shared/ barrel (MicLevelIndicator) reaches the pose detector; its
    // @mediapipe/pose CJS bundle breaks the dep pre-bundle, and no scene uses it.
    optimizeDeps: { entries: [path.join(here, 'index.html')], exclude: ['@tensorflow-models/pose-detection', '@mediapipe/pose'] },
  };
};
