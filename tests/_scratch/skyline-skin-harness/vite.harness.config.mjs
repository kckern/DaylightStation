// Backend-free Vite config for the Skyline skin harness. Reuses the app's Vite
// config; serves /media/* from the media mount and /harness/course from the
// server's own act and zone resolution.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';
import appConfigFn from '../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const PORT = Number(process.env.HARNESS_PORT || 5198);
const MEDIA = process.env.MEDIA_DIR || path.join(process.env.DAYLIGHT_BASE_PATH || '', 'media');
const ADAPTERS = path.join(repoRoot, '__app_modules/wellness/fitness/server/adapters/skylineGlider');
const WORLD_DIR = process.env.WORLD_DIR || null;
const TYPES = { '.png': 'image/png', '.json': 'application/json', '.yml': 'text/yaml', '.mp3': 'audio/mpeg' };

function harness() {
  return {
    name: 'skyline-skin-harness',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://x');
        if (url.pathname.startsWith('/media/')) {
          const file = path.join(MEDIA, decodeURIComponent(url.pathname.slice('/media/'.length)));
          if (!file.startsWith(MEDIA) || !fs.existsSync(file)) { res.statusCode = 404; res.end('missing'); return; }
          res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
          fs.createReadStream(file).pipe(res); return;
        }
        if (url.pathname === '/harness/course') {
          try {
            const { resolveAct } = await import(pathToFileURL(path.join(ADAPTERS, 'resolveAct.mjs')).href);
            // WORLD_DIR (a built world: world.yml, zones/, courses/) is searched before the bundled acts.
            const actName = `${url.searchParams.get('act')}.yml`;
            const worldAct = WORLD_DIR && path.join(WORLD_DIR, 'courses', actName);
            const act = YAML.parse(fs.readFileSync(worldAct && fs.existsSync(worldAct) ? worldAct : path.join(ADAPTERS, 'acts', actName), 'utf8'));
            const zoneId = url.searchParams.get('zone') || act.zone;
            const worldZone = WORLD_DIR && path.join(WORLD_DIR, 'zones', `${zoneId}.yml`);
            const zoneFile = zoneId === 'alpine' ? path.join(ADAPTERS, 'zones/alpine.yml') : worldZone && fs.existsSync(worldZone) ? worldZone : path.join(MEDIA, 'fitness/skyline-glider', zoneId, 'zone.yml');
            const zone = YAML.parse(fs.readFileSync(zoneFile, 'utf8'));
            const course = resolveAct({ ...act, zone: zone.id }, new Map([[zone.id, zone]]));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(course));
          } catch (error) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: error.message })); }
          return;
        }
        if (url.pathname.startsWith('/api/')) { res.statusCode = 404; res.end(`harness: unstubbed backend call ${url.pathname}`); return; }
        next();
      });
    },
  };
}

export default async (env = {}) => {
  const app = await appConfigFn({ mode: 'development', command: 'serve', ...env });
  const aliasList = [
    { find: /^@\/lib\/logging\/Logger\.js$/, replacement: path.join(here, 'stubs/logger.js') },
    ...Object.entries(app.resolve?.alias || {}).map(([find, replacement]) => ({ find, replacement })),
  ];
  return {
    root: here,
    // The app's own public folder, so /fonts/arcade/* (the game faces) load as on the kiosk.
    publicDir: path.join(repoRoot, 'frontend/public'),
    cacheDir: path.join(repoRoot, 'tests/_scratch/out/.vite-skyline-harness-cache'),
    define: app.define, css: app.css,
    plugins: [...(app.plugins || []), harness()],
    resolve: { dedupe: app.resolve?.dedupe, alias: aliasList },
    server: { host: '127.0.0.1', port: PORT, strictPort: true, fs: { strict: false }, watch: null },
    optimizeDeps: { entries: [path.join(here, 'index.html')] },
  };
};
