// Backend-free Vite host for the office piano screen (PianoVisualizer) with
// Sheet Music. The page mounts the real PianoVisualizer; the Playwright spec
// answers every /api/v1 call with fixtures and drives the piano by dispatching
// `midi` bus messages (window.__officeMidi), the exact shape the recorder sends.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import appConfig from '../../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
export const OFFICE_SHEET_MUSIC_PORT = Number(process.env.OFFICE_SHEET_MUSIC_PORT || 3196);

export default async () => {
  const app = await appConfig({ command: 'serve', mode: 'development' });
  return {
    root: here, publicDir: path.join(repo, 'frontend/public'),
    cacheDir: path.join(repo, '.superpowers/office-sheet-music-vite'),
    plugins: app.plugins, define: app.define, css: app.css,
    resolve: { dedupe: ['react', 'react-dom'], alias: Object.entries(app.resolve.alias).map(([find, replacement]) => ({ find, replacement })) },
    server: { host: '127.0.0.1', port: OFFICE_SHEET_MUSIC_PORT, strictPort: true, fs: { allow: [repo] }, hmr: false },
  };
};
