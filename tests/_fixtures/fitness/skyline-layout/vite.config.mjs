import path from 'node:path';
import { fileURLToPath } from 'node:url';
import appConfig from '../../../../frontend/vite.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
export default async () => {
  const app = await appConfig({ command: 'serve', mode: 'development' });
  return {
    root: here, publicDir: path.join(repo, 'frontend/public'),
    cacheDir: path.join(repo, '.superpowers/skyline-layout-vite'),
    plugins: app.plugins, define: app.define, css: app.css,
    resolve: { dedupe: ['react', 'react-dom'], alias: [
      { find: /^@\/lib\/(logging\/Logger\.js|api\.mjs)$/, replacement: path.join(here, 'stubs.js') },
      ...Object.entries(app.resolve.alias).map(([find, replacement]) => ({ find, replacement })),
    ] },
    server: { host: '127.0.0.1', port: 3197, strictPort: true, fs: { allow: [repo] } },
  };
};
