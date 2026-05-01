// @vitest-environment node
/**
 * Integration test for cli/ingest-health-archive.cli.mjs
 *
 * Spawns the CLI as a subprocess (NOT a dynamic import — the CLI's top-level
 * code runs immediately) and asserts on exit code + on-disk filesystem state.
 *
 * Each test gets its own temp dir under os.tmpdir() and cleans up in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'ingest-health-archive.cli.mjs');

const TEST_USER_ID = 'test-user';

/**
 * Run the CLI subprocess. Always resolves with `{exitCode, stdout, stderr}` —
 * never rejects, so tests can assert on non-zero exits without try/catch.
 */
async function runCli(args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      env: { ...process.env, ...(opts.env || {}) },
      cwd: opts.cwd || REPO_ROOT,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    return {
      exitCode: err.code ?? 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('cli/ingest-health-archive.cli.mjs', () => {
  let tmpRoot;
  let sourceDir;
  let dataRoot;
  let mediaRoot;
  let configPath;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-cli-'));
    sourceDir = path.join(tmpRoot, 'external-source');
    dataRoot = path.join(tmpRoot, 'data-root');
    mediaRoot = path.join(tmpRoot, 'media-root');
    configPath = path.join(tmpRoot, 'health-archive.yml');

    // Create the source tree with a couple of files for a single category.
    const notesSrc = path.join(sourceDir, 'notes');
    await fs.mkdir(notesSrc, { recursive: true });
    await fs.writeFile(path.join(notesSrc, '2024-01-15.md'), '# Day notes\nFelt good.\n');
    await fs.writeFile(path.join(notesSrc, '2024-01-16.md'), '# Day notes\nTired.\n');

    const weightSrc = path.join(sourceDir, 'weight');
    await fs.mkdir(weightSrc, { recursive: true });
    await fs.writeFile(
      path.join(weightSrc, 'history.csv'),
      'date,weight_kg\n2024-01-15,80.1\n2024-01-16,80.0\n',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('prints help with --help and exits 0', async () => {
    const { exitCode, stdout } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/ingest-health-archive/i);
    expect(stdout).toMatch(/--user/);
    expect(stdout).toMatch(/--dry-run/);
  });

  it('exits non-zero with helpful error when --user is missing', async () => {
    const { exitCode, stderr } = await runCli([]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/--user/i);
  });

  it('exits non-zero when config file is missing', async () => {
    const { exitCode, stderr } = await runCli([
      '--user', TEST_USER_ID,
      '--config', path.join(tmpRoot, 'does-not-exist.yml'),
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/config/i);
  });

  it('ingests a single enabled category and writes manifest.yml', async () => {
    await fs.writeFile(configPath, yaml.dump({
      sources: {
        notes: {
          path: path.join(sourceDir, 'notes'),
          enabled: true,
        },
      },
      sync: { cadence: 'manual' },
    }));

    const { exitCode, stdout } = await runCli([
      '--user', TEST_USER_ID,
      '--config', configPath,
      '--data-root', dataRoot,
      '--media-root', mediaRoot,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/notes/);

    // Files were copied to data-root (notes is structured)
    const notesDest = path.join(dataRoot, 'notes');
    expect(await pathExists(path.join(notesDest, '2024-01-15.md'))).toBe(true);
    expect(await pathExists(path.join(notesDest, '2024-01-16.md'))).toBe(true);

    // Manifest was written
    const manifestPath = path.join(notesDest, 'manifest.yml');
    expect(await pathExists(manifestPath)).toBe(true);

    const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
    const manifest = yaml.load(manifestRaw);
    expect(manifest.manifest_version).toBe(1);
    expect(manifest.user_id).toBe(TEST_USER_ID);
    expect(manifest.category).toBe('notes');
    expect(manifest.last_sync).toBeTruthy();
    expect(manifest.record_counts).toBeDefined();
    expect(manifest.record_counts.copied).toBe(2);
  });

  it('routes scans category to media-root, not data-root', async () => {
    const scansSrc = path.join(sourceDir, 'scans');
    await fs.mkdir(scansSrc, { recursive: true });
    await fs.writeFile(path.join(scansSrc, 'dexa-2024.pdf'), 'pdf-bytes');

    await fs.writeFile(configPath, yaml.dump({
      sources: {
        scans: {
          path: scansSrc,
          enabled: true,
        },
      },
      sync: { cadence: 'manual' },
    }));

    const { exitCode } = await runCli([
      '--user', TEST_USER_ID,
      '--config', configPath,
      '--data-root', dataRoot,
      '--media-root', mediaRoot,
    ]);

    expect(exitCode).toBe(0);
    // scans land at media-root/scans/{userId}/...
    const scansDest = path.join(mediaRoot, 'scans', TEST_USER_ID);
    expect(await pathExists(path.join(scansDest, 'dexa-2024.pdf'))).toBe(true);
    expect(await pathExists(path.join(scansDest, 'manifest.yml'))).toBe(true);
    // ...and NOT at data-root
    expect(await pathExists(path.join(dataRoot, 'scans'))).toBe(false);
  });

  it('--dry-run does not write any files', async () => {
    await fs.writeFile(configPath, yaml.dump({
      sources: {
        notes: {
          path: path.join(sourceDir, 'notes'),
          enabled: true,
        },
      },
      sync: { cadence: 'manual' },
    }));

    const { exitCode, stdout } = await runCli([
      '--user', TEST_USER_ID,
      '--config', configPath,
      '--data-root', dataRoot,
      '--media-root', mediaRoot,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/dry/i);

    // No copies, no manifest, no destination directory at all
    expect(await pathExists(path.join(dataRoot, 'notes', '2024-01-15.md'))).toBe(false);
    expect(await pathExists(path.join(dataRoot, 'notes', 'manifest.yml'))).toBe(false);
  });

  it('skips disabled categories', async () => {
    await fs.writeFile(configPath, yaml.dump({
      sources: {
        notes: {
          path: path.join(sourceDir, 'notes'),
          enabled: false,
        },
        weight: {
          path: path.join(sourceDir, 'weight'),
          enabled: true,
        },
      },
      sync: { cadence: 'manual' },
    }));

    const { exitCode } = await runCli([
      '--user', TEST_USER_ID,
      '--config', configPath,
      '--data-root', dataRoot,
      '--media-root', mediaRoot,
    ]);

    expect(exitCode).toBe(0);
    // notes was disabled
    expect(await pathExists(path.join(dataRoot, 'notes'))).toBe(false);
    // weight ran
    expect(await pathExists(path.join(dataRoot, 'weight', 'history.csv'))).toBe(true);
    expect(await pathExists(path.join(dataRoot, 'weight', 'manifest.yml'))).toBe(true);
  });

  it('--category restricts to a single category', async () => {
    await fs.writeFile(configPath, yaml.dump({
      sources: {
        notes: {
          path: path.join(sourceDir, 'notes'),
          enabled: true,
        },
        weight: {
          path: path.join(sourceDir, 'weight'),
          enabled: true,
        },
      },
      sync: { cadence: 'manual' },
    }));

    const { exitCode } = await runCli([
      '--user', TEST_USER_ID,
      '--config', configPath,
      '--data-root', dataRoot,
      '--media-root', mediaRoot,
      '--category', 'notes',
    ]);

    expect(exitCode).toBe(0);
    expect(await pathExists(path.join(dataRoot, 'notes', '2024-01-15.md'))).toBe(true);
    expect(await pathExists(path.join(dataRoot, 'weight'))).toBe(false);
  });

  it('--source overrides the config-derived source path', async () => {
    // Config points at a path that does NOT have the right files,
    // but --source redirects to the populated dir.
    const altSource = path.join(tmpRoot, 'alt-notes');
    await fs.mkdir(altSource, { recursive: true });
    await fs.writeFile(path.join(altSource, 'override-1.md'), 'override\n');

    await fs.writeFile(configPath, yaml.dump({
      sources: {
        notes: {
          path: path.join(tmpRoot, 'wrong-path-that-doesnt-exist'),
          enabled: true,
        },
      },
      sync: { cadence: 'manual' },
    }));

    const { exitCode } = await runCli([
      '--user', TEST_USER_ID,
      '--config', configPath,
      '--data-root', dataRoot,
      '--media-root', mediaRoot,
      '--source', altSource,
      '--category', 'notes',
    ]);

    expect(exitCode).toBe(0);
    expect(await pathExists(path.join(dataRoot, 'notes', 'override-1.md'))).toBe(true);
  });

  it('exits 1 when a category fails (e.g. missing source)', async () => {
    await fs.writeFile(configPath, yaml.dump({
      sources: {
        notes: {
          path: path.join(tmpRoot, 'no-such-dir'),
          enabled: true,
        },
      },
      sync: { cadence: 'manual' },
    }));

    const { exitCode, stderr } = await runCli([
      '--user', TEST_USER_ID,
      '--config', configPath,
      '--data-root', dataRoot,
      '--media-root', mediaRoot,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
