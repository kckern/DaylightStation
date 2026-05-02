// @vitest-environment node
/**
 * Subprocess test of the dscli entry. Spawns `node cli/dscli.mjs ...` and
 * asserts on exit code + stdout + stderr. Mirrors the pattern in
 * tests/unit/cli/ingest-health-archive.test.mjs.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'dscli.mjs');

async function runDscli(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      cwd: REPO_ROOT,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    return { exitCode: err.code ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

describe('cli/dscli.mjs entry', () => {
  it('prints help and exits 0 with no args', async () => {
    const { exitCode, stdout } = await runDscli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/dscli/);
    expect(stdout).toMatch(/Usage/i);
  });

  it('prints help and exits 0 with --help', async () => {
    const { exitCode, stdout } = await runDscli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Subcommands/i);
  });

  it('exits 2 with usage error on unknown subcommand', async () => {
    const { exitCode, stderr } = await runDscli(['nonsense-subcommand']);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/unknown subcommand/i);
    expect(stderr).toMatch(/nonsense-subcommand/);
  });
});
