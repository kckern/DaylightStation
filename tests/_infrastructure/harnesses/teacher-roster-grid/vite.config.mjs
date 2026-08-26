// Vite config for the teacher roster-grid harness. Serves the harness page
// with the worktree's real frontend sources and compiled SCSS — no stubs; the
// only fake is the fetch shim in main.jsx that answers the agenda preview.
import path from 'path';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(__dirname, '../../../..');
// The worktree's frontend/node_modules is a symlink into the main checkout;
// resolve it so aliases and fs.allow point at real paths.
const frontendNodeModules = realpathSync(path.join(worktreeRoot, 'frontend/node_modules'));

const { default: react } = await import(
  path.join(frontendNodeModules, '@vitejs/plugin-react/dist/index.mjs')
);

export default {
  root: __dirname,
  plugins: [react()],
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
