// Backend-free Vite config for the Skyline Invaders visual harness. Reuses the
// app's Vite config; refuses anything that would have gone to the backend.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import appConfigFn from '../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const PORT = Number(process.env.HARNESS_PORT || 5196);

const harnessLevel = (id, name, over = {}) => ({
  schema: 'skyline-invaders-level/v1', id, name, duration_s: 30, pass: { kills: 4 },
  waves: [{ at: 0, rate_s: 1.2, spawn: { meteor: 3, drone: 2, pod: 1 } }], boost: { fill_s: 6 }, ...over,
});
const HARNESS_LEVELS = [harnessLevel('invaders-1-1', 'First Wave'), harnessLevel('invaders-1-2', 'Drone Swarm'), harnessLevel('invaders-1-3', 'Bomber Run')];
const HARNESS_WORLD = {
  riderId: 'kid', next: 'invaders-1-2',
  levels: [
    { id: 'invaders-1-1', name: 'First Wave', status: 'completed', best: { stars: 2, score: 940 } },
    { id: 'invaders-1-2', name: 'Drone Swarm', status: 'open' },
    { id: 'invaders-1-3', name: 'Bomber Run', status: 'locked' },
  ],
};

function refuseBackend() {
  return {
    name: 'skyline-invaders-harness',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const query = new URLSearchParams((req.headers.referer || '').split('?')[1] || '');
        const json = (body, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        // The shell harness's level API: three levels, the third locked.
        if (url === '/api/v1/fitness/skyline-invaders/levels') {
          if (query.get('levels') === 'fail') return json({ error: 'unavailable' }, 503);
          return json({ levels: query.get('levels') === 'none' ? [] : HARNESS_LEVELS });
        }
        if (url === '/api/v1/fitness/skyline-invaders/world') return json(HARNESS_WORLD);
        if (url === '/api/v1/fitness/skyline-invaders/runs') return query.get('save') === 'fail' ? json({ error: 'down' }, 503) : json({ created: true }, 201);
        // `?kiosk=1` turns the school-day gate on: the learner's day is not done.
        if (url === '/api/v1/entitlements') {
          const now = Date.now();
          return json({ items: [{
            capabilityId: 'fitness.skyline-invaders', gateId: 'school.day-complete', decision: 'denied', basisState: 'unsatisfied', degraded: false,
            subject: { kind: 'learner', id: 'kid' }, period: { kind: 'interval', id: 'school-day:2026-11-11', startsAt: 0, endsAt: now + 86_400_000 },
            validFrom: 0, validUntil: now + 86_400_000,
          }] });
        }
        // No sound files in the harness: an empty body is the "not installed yet" case.
        if (url.includes('/media/fitness/skyline-invaders/sounds/')) { res.statusCode = 200; res.end(''); return; }
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
        // The shell harness's stubbed edges (shell.jsx). The scene harness imports none of these.
        { find: /^.*\/context\/FitnessContext\.jsx$/, replacement: path.join(here, 'stubs/fitnessContext.jsx') },
        { find: /^.*\/context\/PoseContext\.jsx$/, replacement: path.join(here, 'stubs/poseContext.jsx') },
        { find: /^\.\/InvadersPoseBridge\.jsx$/, replacement: path.join(here, 'stubs/poseBridge.jsx') },
        { find: /^.*\/player\/useFitnessModule\.js$/, replacement: path.join(here, 'stubs/fitnessModule.js') },
        { find: /^.*\/identity\/useIdentity\.js$/, replacement: path.join(here, 'stubs/identity.js') },
        { find: /^@\/hooks\/useWebSocket\.js$/, replacement: path.join(here, 'stubs/webSocket.js') },
        { find: /^@\/lib\/kioskEnv\.js$/, replacement: path.join(here, 'stubs/kioskEnv.js') },
        ...Object.entries(app.resolve?.alias || {}).map(([find, replacement]) => ({ find, replacement })),
      ],
    },
    server: { host: '127.0.0.1', port: PORT, strictPort: true, fs: { strict: false }, watch: { ignored: ['**/node_modules/**', '**/.git/**', '**/data/**', '**/tests/_scratch/out/**'] } },
    optimizeDeps: { entries: [path.join(here, 'index.html'), path.join(here, 'shell.html')] },
  };
};
