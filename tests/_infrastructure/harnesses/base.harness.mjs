// tests/_infrastructure/harnesses/base.harness.mjs
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

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

export function findTestFiles(baseDir, targets, args) {
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
        } else if (entry.name.endsWith('.test.mjs')) {
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

export function runJest(files, options = {}) {
  return new Promise((resolve, reject) => {
    const jestArgs = [
      '--experimental-vm-modules',
      'npx', 'jest',
      ...files,
      '--colors',
    ];

    if (options.coverage) jestArgs.push('--coverage');
    if (options.watch) jestArgs.push('--watch');
    if (options.verbose) jestArgs.push('--verbose');
    if (options.runInBand) jestArgs.push('--runInBand');

    const child = spawn('node', jestArgs, {
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
