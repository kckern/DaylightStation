// Backend-free Vite config for the piano settings sheets harness.
// Reuses the app's config (plugins, scss, aliases, define); swaps the piano
// hooks, logger, API and feedback overlay for scene-driven stubs, and serves
// instrument art straight from the media tree on disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import appConfigFn from '../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const PORT = Number(process.env.HARNESS_PORT || 5198);
const MEDIA_IMG = process.env.MEDIA_IMG_DIR || (process.env.DAYLIGHT_BASE_PATH ? path.join(process.env.DAYLIGHT_BASE_PATH, 'media/img') : null);

const piano = path.join(here, 'stubs/piano.jsx');
const STUBBED = ['usePianoSoundBundle.js', 'usePianoPreset.js', 'PianoConfig.jsx', 'usePianoSound.js', 'usePianoMix.js', 'PianoMidiContext.jsx', 'usePianoConnection.js', 'usePianoScreenOff.js', 'useScreenControl.js', 'useBridgeMidiTap.js'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function harnessAssets() {
  return {
    name: 'piano-settings-harness-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0]);
        const m = url.match(/^\/api\/v1\/static\/img\/(.+\.svg)$/);
        if (m && MEDIA_IMG) {
          const file = path.join(MEDIA_IMG, m[1]);
          if (file.startsWith(MEDIA_IMG) && fs.existsSync(file)) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(fs.readFileSync(file)); return; }
        }
        if (url.startsWith('/api/') || url.startsWith('/ws')) { res.statusCode = 404; res.end(`harness: unstubbed backend call ${url}`); return; }
        next();
      });
    },
  };
}

export default async (env = {}) => {
  const app = await appConfigFn({ mode: 'development', command: 'serve', ...env });
  const appAlias = app.resolve?.alias || {};
  const aliasList = [
    { find: /^.*frontend\/src\/lib\/logging\/Logger\.js$/, replacement: path.join(here, 'stubs/logger.js') },
    { find: /^@\/lib\/logging\/Logger\.js$/, replacement: path.join(here, 'stubs/logger.js') },
    { find: /^.*frontend\/src\/lib\/api\.mjs$/, replacement: piano },
    { find: /^.*Feedback\/FeedbackOverlay\.jsx$/, replacement: path.join(here, 'stubs/FeedbackOverlay.jsx') },
    ...STUBBED.map((name) => ({ find: new RegExp(`^\\.\\/${esc(name)}$`), replacement: piano })),
    ...Object.entries(appAlias).map(([find, replacement]) => ({ find, replacement })),
  ];
  return {
    root: here,
    cacheDir: path.join(repoRoot, 'tests/_scratch/out/.vite-piano-settings-cache'),
    define: app.define,
    css: app.css,
    plugins: [...(app.plugins || []), harnessAssets()],
    resolve: { dedupe: app.resolve?.dedupe, alias: aliasList },
    server: { host: '127.0.0.1', port: PORT, strictPort: true, fs: { strict: false }, watch: null },
    optimizeDeps: { entries: [path.join(here, 'index.html')] },
  };
};
