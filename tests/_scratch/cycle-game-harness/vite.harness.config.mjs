// Backend-free Vite config for the cycle-game visual harness.
// Reuses the app's own config (plugins, scss options, aliases, define) and only
// overrides: root, the logger (no WebSocket), the dev-server bind, and a
// middleware that answers the /api/v1/static/img/* asset URLs with generated SVG.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import appConfigFn from '../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const PORT = Number(process.env.HARNESS_PORT || 5199);

const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function faceSvg(id) {
  const raw = decodeURIComponent(id);
  const letter = (raw.replace(/^ghost:[^:]*:/, '').replace(/^(user_|rider-)/, '')[0] || '?').toUpperCase();
  const h = hue(raw);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" fill="hsl(${h},45%,32%)"/>
<circle cx="50" cy="40" r="20" fill="hsl(${h},55%,72%)"/>
<path d="M14 100c2-26 18-36 36-36s34 10 36 36z" fill="hsl(${h},55%,72%)"/>
<text x="50" y="48" font-family="sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="hsl(${h},45%,20%)">${letter}</text></svg>`;
}

const BIKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" fill="#1b1d2e"/>
<g fill="none" stroke="#8fd3ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
<circle cx="28" cy="64" r="16"/><circle cx="74" cy="64" r="16"/>
<path d="M28 64 40 36h24l10 28M40 36l12 28h-24M64 36l-4-8h10"/></g></svg>`;

function harnessAssets() {
  return {
    name: 'cycle-harness-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        let m = url.match(/^\/api\/v1\/static\/img\/users\/(.+)$/);
        if (m) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(faceSvg(m[1])); return; }
        if (/^\/api\/v1\/static\/img\/equipment\//.test(url)) {
          res.setHeader('Content-Type', 'image/svg+xml'); res.end(BIKE_SVG); return;
        }
        if (url.startsWith('/api/') || url.startsWith('/ws')) {
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
    { find: /^@\/lib\/logging\/Logger\.js$/, replacement: path.join(here, 'stubs/logger.js') },
    ...Object.entries(appAlias).map(([find, replacement]) => ({ find, replacement })),
    // The race road imports these from __app_modules, whose nearest node_modules
    // (the repo root) may not carry them; the frontend's always does.
    { find: /^three$/, replacement: path.join(repoRoot, 'frontend/node_modules/three/build/three.module.js') },
    { find: /^three\/(.*)$/, replacement: path.join(repoRoot, 'frontend/node_modules/three/$1') },
    { find: /^camera-controls$/, replacement: path.join(repoRoot, 'frontend/node_modules/camera-controls/dist/camera-controls.module.js') },
  ];
  return {
    root: here,
    // Keep the dep cache out of the (shared, symlinked) node_modules.
    cacheDir: path.join(repoRoot, 'tests/_scratch/out/.vite-harness-cache'),
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
    optimizeDeps: { entries: [path.join(here, 'index.html')] },
  };
};
