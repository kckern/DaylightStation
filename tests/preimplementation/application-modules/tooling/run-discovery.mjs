/** Reviewed files-only discovery. Never imports a test or starts a controller. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root, packet} from './census.mjs';

const mode = process.argv[2];
const modes = ['jest-root', 'jest-backend', 'isolated', 'backend', 'legacy-unit'];
if (!modes.includes(mode)) throw new Error('Choose ' + modes.join(', '));
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-discovery-')));
const testRoot = path.join(root, 'tests/preimplementation/application-modules');
const inputPaths = ['tests/preimplementation/application-modules/tooling/run-discovery.mjs',
  'tests/preimplementation/application-modules/tooling/census.mjs',
  'tests/preimplementation/application-modules/configs/node.sbp', 'package.json'];
let command;
let overrides = [];
if (mode.startsWith('jest-')) {
  const configPath = mode === 'jest-root' ? 'jest.config.js' : 'backend/jest.config.js';
  inputPaths.push(configPath);
  const config = mode === 'jest-root'
    ? createRequire(import.meta.url)(path.join(root, configPath))
    : (await import(pathToFileURL(path.join(root, configPath)))).default;
  const discoveryConfig = {...config,
    rootDir: path.dirname(path.join(root, configPath)),
    cacheDirectory: path.join(runRoot, 'jest-cache'),
    modulePaths: [path.join(toolRoot, 'node_modules'), path.join(toolRoot, 'backend/node_modules')],
    watchman: false,
  };
  if (discoveryConfig.transform) discoveryConfig.transform = Object.fromEntries(
    Object.entries(discoveryConfig.transform).map(([pattern, value]) => [pattern,
      value === 'babel-jest' ? createRequire(path.join(toolRoot, 'package.json')).resolve('babel-jest') : value]));
  overrides = ['task-only cache', 'watchman disabled to prevent process spawn',
    'original installed module paths and absolute babel-jest; include/exclude rules unchanged'];
  command = [path.join(toolRoot, 'node_modules/jest/bin/jest.js'), '--config',
    JSON.stringify(discoveryConfig), '--listTests', '--json', '--runInBand'];
} else {
  const harness = mode === 'legacy-unit' ? 'tests/unit/harness.mjs'
    : 'tests/_infrastructure/harnesses/isolated.harness.mjs';
  inputPaths.push(harness);
  if (mode !== 'legacy-unit') inputPaths.push('tests/_infrastructure/harnesses/base.harness.mjs');
  command = [path.join(root, harness), '--dry-run'];
  if (mode === 'backend') {
    const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).scripts['test:backend'];
    const match = script.match(/^node tests\/_infrastructure\/harnesses\/isolated\.harness\.mjs (--only=[a-z0-9,-]+)$/);
    if (!match) throw new Error('Re-review changed test:backend before execution');
    command.push(match[1]);
  }
}
const params = {WORKTREE: root, RUN_ROOT: runRoot,
  ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'),
  FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), ROOT_MANIFEST: path.join(toolRoot, 'package.json'),
  BACKEND_MANIFEST: path.join(toolRoot, 'backend/package.json'), FRONTEND_MANIFEST: path.join(toolRoot, 'frontend/package.json')};
const args = [...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]),
  '-f', path.join(testRoot, 'configs/node.sbp'), process.execPath, ...command];
const result = spawnSync('/usr/bin/sandbox-exec', args, {cwd: root, encoding: 'utf8',
  timeout: 90000, maxBuffer: 32 * 1024 * 1024,
  env: {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC',
    TMPDIR: runRoot, XDG_CACHE_HOME: path.join(runRoot, 'cache')}});
const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot,
  '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
let files = null;
let parseError = null;
try {
  if (mode.startsWith('jest-')) files = JSON.parse(result.stdout).map(p => path.relative(root, p)).sort();
  else if (mode !== 'legacy-unit') files = result.stdout.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith(root + '/'))
    .map(p => path.relative(root, p)).sort();
} catch (error) { parseError = clean(error.message); }
const name = 'discovery-' + mode + '-' + new Date().toISOString().replaceAll(':', '-') + '.json';
const report = {schema: 'daylight.preimplementation.runner-discovery/v1',
  id: 'RUN-DISCOVERY-' + Date.now(), capturedAt: new Date().toISOString(),
  baseline: JSON.parse(fs.readFileSync(path.join(packet, 'baseline.json'))).revision,
  mode, pack: 'discovery-' + mode,
  command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-discovery.mjs ' + mode,
  node: process.version, exitCode: result.status, signal: result.signal, overrides, files,
  fileCount: files?.length ?? null, parseError, stdout: clean(result.stdout), stderr: clean(result.stderr),
  inputs: inputPaths.map(name => ({name, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')})),
  inputBase: 'repository root',
  limits: ['File selection only; test bodies and parameterized cases not evaluated',
    mode === 'legacy-unit' ? 'Original harness emits its exact proposed Jest command, not discovered files' :
      mode.startsWith('jest-') ? 'Actual Jest discovery with stated installed-scope/safety overrides, not a native install proof' :
        'Actual original harness file list, not downstream runner collection or assertions',
    'Network, process fork, private reads and non-task writes denied by OS profile']};
fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({evidence: 'evidence/' + name, exitCode: result.status, fileCount: files?.length, parseError}) + '\n');
if (result.status !== 0 || parseError) {
  process.stdout.write(clean(result.stderr) + '\n');
  process.exitCode = 1;
}
