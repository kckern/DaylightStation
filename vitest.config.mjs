import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, realpathSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In worktrees, frontend/node_modules may not exist — fall back to the main repo.
// Worktrees can live either INSIDE the main repo (.claude/worktrees/<name>, 3 levels
// deep) or as a SIBLING checkout. To cover both, resolve candidate locations and pick
// the first that exists. The root `node_modules` is symlinked to the main checkout, so
// its realpath gives us the main repo root regardless of worktree layout.
const frontendNodeModulesLocal = path.resolve(__dirname, 'frontend/node_modules');
const candidates = [
  frontendNodeModulesLocal,
  path.resolve(__dirname, '../../../frontend/node_modules'),
];
try {
  // node_modules -> <main-repo>/node_modules ; its parent is the main repo root.
  const mainRepoRoot = path.dirname(realpathSync(path.join(__dirname, 'node_modules')));
  candidates.push(path.join(mainRepoRoot, 'frontend/node_modules'));
} catch (_) { /* no node_modules symlink — rely on other candidates */ }
const frontendNodeModules = candidates.find((p) => existsSync(p)) || frontendNodeModulesLocal;

// Load React plugin from frontend's node_modules (it's not installed at the root).
const { default: react } = await import(path.join(frontendNodeModules, '@vitejs/plugin-react/dist/index.mjs'));

export default {
  // React plugin enables automatic JSX runtime so test files don't need `import React`.
  plugins: [react()],
  resolve: {
    alias: {
      '#frontend': path.resolve(__dirname, 'frontend/src'),
      '@': path.resolve(__dirname, 'frontend/src'),
      '@shared-contracts': path.resolve(__dirname, 'shared/contracts'),
      '@shared-music': path.resolve(__dirname, 'shared/music'),
      '@shared-gaming': path.resolve(__dirname, 'shared/gaming'),
      '@shared-interaction': path.resolve(__dirname, 'shared/interaction'),
      '@shared-presentation': path.resolve(__dirname, 'shared/presentation/scenes'),
      '@testing-library/react': path.join(frontendNodeModules, '@testing-library/react'),
      '@testing-library/jest-dom': path.join(frontendNodeModules, '@testing-library/jest-dom'),
      '@mantine/core': path.join(frontendNodeModules, '@mantine/core'),
      '@mantine/notifications': path.join(frontendNodeModules, '@mantine/notifications'),
      'react-router-dom': path.join(frontendNodeModules, 'react-router-dom'),
      '@mantine/charts': path.join(frontendNodeModules, '@mantine/charts'),
      'dash-video-element': path.join(frontendNodeModules, 'dash-video-element'),
      'react': path.join(frontendNodeModules, 'react'),
      'react-dom': path.join(frontendNodeModules, 'react-dom'),
    },
  },
  test: {
    globals: true,
    // Worker pool: threads, deliberately. The default forks pool intermittently
    // dies at worker recycle with "EnvironmentTeardownError: Closing rpc while
    // onUserConsoleLog was pending" (exit 1 with zero test failures) — its
    // process-IPC console forwarding races the worker shutdown under full-sweep
    // load (~1 in 3 runs, 2026-07-30, vitest 4.1.10). The threads pool's
    // MessagePort transport doesn't exhibit the race: 6/6 clean sweeps, same
    // test counts and duration.
    pool: 'threads',
    environment: path.resolve(__dirname, 'tests/_infrastructure/frontend-env.mjs'),
    // Loads @testing-library/jest-dom matchers so `expect(el).toBeInTheDocument()` works.
    setupFiles: [path.resolve(__dirname, 'frontend/src/test-setup.js')],
    // `.claude/worktrees/` and `.worktrees/` hold isolated feature worktrees with
    // their own copies of every test file. A glob run would otherwise collect (and
    // re-run, often stale) those duplicates alongside the canonical suite — exclude
    // them. The rest mirror vitest's built-in defaults, which a custom `exclude`
    // would otherwise drop.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.claude/worktrees/**',
      '**/.claire/worktrees/**',
      '**/.worktrees/**',
      // Scratch that is on its way out (CLAUDE.md: "can't delete? move to
      // _deleteme/"). A probe test parked here still got collected, inflating
      // counts and tearing down noisily mid-sweep.
      '**/_deleteme/**',
    ],
  },
};
