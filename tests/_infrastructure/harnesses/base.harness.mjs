// tests/_infrastructure/harnesses/base.harness.mjs
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'node:url';

export const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

export function parseArgs(argv) {
  const args = {
    only: null,
    skip: null,
    pattern: null,
    verbose: false,
    dryRun: false,
    watch: false,
    coverage: false,
    env: 'dev',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--only=')) args.only = arg.split('=')[1].split(',');
    else if (arg.startsWith('--skip=')) args.skip = arg.split('=')[1].split(',');
    else if (arg.startsWith('--pattern=')) args.pattern = arg.split('=')[1];
    else if (arg.startsWith('--env=')) args.env = arg.split('=')[1];
    else if (arg === '-v' || arg === '--verbose') args.verbose = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '-w' || arg === '--watch') args.watch = true;
    else if (arg === '--coverage') args.coverage = true;
  }

  return args;
}

export function findTestFiles(baseDir, targets, args, options = {}) {
  const { extensions = ['.test.mjs'] } = options;
  const files = [];

  const searchDirs = args.only || targets;
  const skipDirs = new Set(args.skip || []);

  for (const target of searchDirs) {
    if (skipDirs.has(target)) continue;

    const targetDir = path.join(baseDir, target);
    if (!fs.existsSync(targetDir)) continue;

    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
          if (!args.pattern || fullPath.includes(args.pattern)) {
            files.push(fullPath);
          }
        }
      }
    };
    walk(targetDir);
  }

  return files;
}

/**
 * Walks an arbitrary tree (e.g. `frontend/src/`) collecting any test files
 * with the given extensions. Used by the isolated harness to discover
 * colocated vitest specs that live next to the code they cover, outside
 * the `tests/isolated/{target}/` layout.
 */
export function findColocatedTestFiles(rootDir, args, options = {}) {
  const { extensions = ['.test.js', '.test.jsx', '.test.mjs'] } = options;
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        if (!args.pattern || fullPath.includes(args.pattern)) {
          files.push(fullPath);
        }
      }
    }
  };
  walk(rootDir);
  return files;
}

export function runJest(files, options = {}) {
  return new Promise((resolve, reject) => {
    const jestArgs = [
      'jest',
      '--config', fileURLToPath(new URL('../config/jest.config.cjs', import.meta.url)),
      ...files,
      '--colors',
    ];

    if (options.coverage) jestArgs.push('--coverage');
    if (options.watch) jestArgs.push('--watch');
    if (options.verbose) jestArgs.push('--verbose');
    if (options.runInBand) jestArgs.push('--runInBand');

    const child = spawn('npx', jestArgs, {
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: '--experimental-vm-modules' },
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Jest exited with code ${code}`));
    });
  });
}

export function printSummary(label, files, args) {
  console.log(`\n${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${label} Test Suite${COLORS.reset}`);
  console.log(`${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`  Files: ${files.length}`);
  if (args.only) console.log(`  Only: ${args.only.join(', ')}`);
  if (args.skip) console.log(`  Skip: ${args.skip.join(', ')}`);
  if (args.pattern) console.log(`  Pattern: ${args.pattern}`);
  console.log(`${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}\n`);
}

/** Resolve both categorized applications and flat capability owners. */
export function findOwnerDirectories(projectRoot, kind) {
  const root = path.join(projectRoot, kind);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) return [];
  const directories = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'node_modules');
  return directories.flatMap(entry => {
    const directory = path.join(root, entry.name);
    const hasSurface = ['server', 'browser', 'cli', 'portable', 'satellites', 'tests', 'seeds'].some(surface => {
      const candidate = path.join(directory, surface);
      return fs.existsSync(candidate) && fs.lstatSync(candidate).isDirectory();
    });
    return kind === '__app_modules' && !hasSurface
      ? fs.readdirSync(directory, { withFileTypes: true }).filter(child => child.isDirectory() && child.name !== 'node_modules').map(child => path.join(directory, child.name))
      : [directory];
  });
}

/** Browser ownership changes physical paths, not the frontend test population. */
export function findBrowserColocatedTestFiles(projectRoot, args) {
  const files = findColocatedTestFiles(path.join(projectRoot, 'frontend/src'), args);
  for (const kind of ['__app_modules', '__capabilities']) {
    for (const owner of findOwnerDirectories(projectRoot, kind)) {
      const browser = path.join(owner, 'browser');
      if (!fs.existsSync(browser) || !fs.lstatSync(browser).isDirectory()) continue;
      files.push(...findColocatedTestFiles(browser, args).filter(file => fs.lstatSync(file).isFile()));
    }
  }
  // This original frontend boundary oracle moved into the dedicated test tree.
  const boundary = path.join(projectRoot, 'tests/unit/architecture/gaming-boundaries.test.js');
  if (fs.existsSync(boundary) && fs.lstatSync(boundary).isFile() && (!args.pattern || boundary.includes(args.pattern))) files.push(boundary);
  return [...new Set(files)].sort();
}
