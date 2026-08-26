import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, realpathSync, readFileSync, readdirSync } from 'fs';

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

// ---------------------------------------------------------------------------
// WHICH RUNNER OWNS A FILE IS DECIDED BY WHAT IT IMPORTS, NOT WHERE IT LIVES.
//
// The repo runs three runners over one `*.test.*` namespace. A directory-glob
// vitest run therefore collects `node:test` files, finds no vitest suite, and
// reports a FAILURE for a file that passes perfectly under `node --test` —
// which trains everyone to skim past the gate's failing list, the exact habit
// that lets a real regression through.
//
// This mirrors the ownership rule `scripts/gate-vitest.mjs` already applies
// (see its header): an explicit `node:test` import means another runner owns
// the file. Listing such files by hand instead — as this config did — is a
// list that grows every time someone points vitest at a new directory; there
// are 60-odd `node:test` files it could hit.
const NODE_TEST_IMPORT = /from\s+['"]node:test['"]/;
// Files kept in vitest's population ON PURPOSE, despite being node:test.
// `pianoGames` fails 3 of 5 real tests under `node --test` (OpponentLadder
// normalizeSeriesEntry, and a 'Level 1' vs 'Diglett' mismatch). That is a
// genuine bug. Excluding it would hide the failure rather than fix how it is
// reported, so it stays visible until the bug is fixed.
const KEEP_VISIBLE = new Set(['pianoGames.test.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '_deleteme', '.claude', '.claire', '.worktrees']);

function nodeTestFiles(dir, found = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) nodeTestFiles(path.join(dir, entry.name), found);
    } else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name) && !KEEP_VISIBLE.has(entry.name)) {
      const full = path.join(dir, entry.name);
      try {
        if (NODE_TEST_IMPORT.test(readFileSync(full, 'utf8'))) found.push(full);
      } catch { /* unreadable — leave it in the population */ }
    }
  }
  return found;
}
const nodeTestExcludes = nodeTestFiles(__dirname).map((f) => path.relative(__dirname, f));

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
    // WALL-CLOCK CEILINGS ARE CALIBRATED FOR AN IDLE MACHINE, and this suite is
    // ~1,000 files run across every core at once. A worker starved for a slice
    // past the 5s default fails whichever timing-shaped test it was inside —
    // one roaming victim per sweep (QuizRunner, AdminPreviewPlayer,
    // WeeklyReview, RubiksCubeProgram…), each passing every solo run, none of
    // them sharing a cause beyond the clock. This raises only how long a
    // starved worker MAY take; it changes nothing about what has to become
    // true, and a genuinely hung test still fails, just later.
    //
    // It must also stay above `asyncUtilTimeout` (5s, frontend/src/test-setup.js)
    // — a waitFor allowed to outlive its own test only moves the failure.
    testTimeout: 20000,
    hookTimeout: 20000,
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
      // Every `node:test` file, found by what it imports (see above). This
      // replaces a hand-maintained list; excluding them fixes the REPORTING,
      // not the coverage — `npm run test:backend` still runs them all.
      ...nodeTestExcludes,
    ],
  },
};
