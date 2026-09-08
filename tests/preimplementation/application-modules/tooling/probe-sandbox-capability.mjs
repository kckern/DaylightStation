/** Verify that the required macOS sandbox can be applied before a product pack starts. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, emit } from './census.mjs';

if (!process.env.PRE_TOOLCHAIN_ROOT) throw new Error('Explicit toolchain root required');
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-preimplementation-sandbox-probe-'));
const runRoot = path.join(temporaryRoot, 'allowed');
fs.mkdirSync(runRoot);
const params = {
  WORKTREE: root,
  RUN_ROOT: runRoot,
  ROOT_DEPS: path.join(toolRoot, 'node_modules'),
  BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'),
  FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'),
  ROOT_MANIFEST: path.join(toolRoot, 'package.json'),
  BACKEND_MANIFEST: path.join(toolRoot, 'backend/package.json'),
  FRONTEND_MANIFEST: path.join(toolRoot, 'frontend/package.json')
};
const result = spawnSync('/usr/bin/sandbox-exec', [
  ...Object.entries(params).flatMap(([key, value]) => ['-D', `${key}=${value}`]),
  '-f', path.join(root, 'tests/preimplementation/application-modules/configs/node.sbp'),
  '/usr/bin/true'
], { cwd: root, encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin', TMPDIR: runRoot } });
const output = String(result.stdout || '');
const error = String(result.stderr || '');
const denied = /sandbox_apply:\s*Operation not permitted/i.test(error);
const state = result.status === 0 ? 'available' : result.error?.code === 'ENOENT' ? 'missing' : denied ? 'host-denied' : 'failed';
const report = {
  schema: 'daylight.preimplementation.sandbox-capability/v1',
  capturedAt: new Date().toISOString(),
  state,
  command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/probe-sandbox-capability.mjs',
  profile: 'tests/preimplementation/application-modules/configs/node.sbp',
  probe: '/usr/bin/true only; no application module, test case, server, network or product process started',
  exitCode: result.status,
  signal: result.signal,
  error: result.error?.message || null,
  stderr: error,
  stdout: output,
  nextAction: state === 'available' ? 'Run the selected isolated baseline pack.' : 'Restore or approve the macOS sandbox capability; do not bypass the profile.'
};
fs.rmSync(temporaryRoot, { recursive: true, force: true });
emit('sandbox-capability.json', report);
process.stdout.write(JSON.stringify({ state, exitCode: result.status, nextAction: report.nextAction }) + '\n');
if (state !== 'available') process.exitCode = 1;
