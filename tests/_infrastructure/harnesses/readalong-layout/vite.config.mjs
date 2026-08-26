// Vite config for the readalong layout harness. Serves the harness page with
// the worktree's real frontend sources; the only substitution is Player.jsx →
// stubPlayer.jsx (see stubPlayer.jsx for why).
import path from 'path';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(__dirname, '../../../..');
const playerPath = path.join(worktreeRoot, 'frontend/src/modules/Player/Player.jsx');
const stubPath = path.join(__dirname, 'stubPlayer.jsx');
// The worktree's frontend/node_modules is a symlink into the main checkout;
// resolve it so aliases and fs.allow point at real paths.
const frontendNodeModules = realpathSync(path.join(worktreeRoot, 'frontend/node_modules'));

const { default: react } = await import(
  path.join(frontendNodeModules, '@vitejs/plugin-react/dist/index.mjs')
);

export default {
  root: __dirname,
  plugins: [
    react(),
    {
      name: 'stub-player',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer) return null;
        const resolved = source.startsWith('.')
          ? path.resolve(path.dirname(importer), source)
          : source;
        if (resolved === playerPath) return stubPath;
        return null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: 'react-dom', replacement: path.join(frontendNodeModules, 'react-dom') },
      { find: 'react', replacement: path.join(frontendNodeModules, 'react') },
    ],
  },
  server: {
    fs: { allow: [worktreeRoot, path.dirname(path.dirname(frontendNodeModules))] },
  },
};
