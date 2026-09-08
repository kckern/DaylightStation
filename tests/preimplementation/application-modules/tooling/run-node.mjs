/** Exact isolated Node test command. No install, server or product entrypoint. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, packet } from './census.mjs';
import { candidatePreflight } from '../drivers/gratitude-target.mjs';
import { browserCandidatePreflight } from '../drivers/browser-target.mjs';
const packs = new Set(['isolation', 'gratitude', 'rendering', 'browser', 'architecture', 'packages', 'registrations']);
const pack = process.argv[2];
const mutation = process.argv[3] || null;
const expectedFailures = {
  'missing-mount': 'CASE-GR-HTTP-01',
  'changed-response': 'CASE-GR-HTTP-16',
  'changed-storage': 'CASE-GR-SELECTION-HISTORY',
  'failed-print-marks': 'CASE-GR-HTTP-18-false',
  'duplicate-event': 'CASE-GR-HTTP-14',
  'missing-cleanup': 'CASE-GR-TEMP-CLEANUP-false',
  'missing-asset': 'CASE-GR-RENDER-NATIVE'
};
if (mutation && !expectedFailures[mutation]) throw new Error('Unknown mutation');
if (!packs.has(pack)) throw new Error('Choose an explicitly allowlisted preparation pack');
if (!process.env.PRE_TOOLCHAIN_ROOT) throw new Error('Explicit toolchain root required');
if ((process.env.PRE_TARGET || 'baseline') === 'candidate' && !['gratitude', 'browser'].includes(pack)) throw new Error('Candidate target is currently defined only for Gratitude and browser packs');
const candidate = pack === 'browser' ? browserCandidatePreflight() : candidatePreflight();
if (candidate.state === 'not-run') {
  const evidenceDir = path.join(packet, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const name = 'candidate-not-run-' + new Date().toISOString().replaceAll(':', '-') + '.json';
  fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify({
    schema: 'daylight.preimplementation.candidate-preflight/v1', capturedAt: new Date().toISOString(), pack,
    target: candidate.target, state: candidate.state, reason: candidate.reason,
    command: 'PRE_TARGET=candidate PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-node.mjs ' + pack,
    result: 'No test process was started; candidate parity was not claimed.'
  }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, ...candidate }) + '\n');
  process.exit(0);
}
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const baselineEvidence = process.env.PRE_TARGET === 'candidate' ? path.resolve(process.env.PRE_BASELINE_EVIDENCE) : null;
let baselinePassed = null;
if (baselineEvidence) {
  if (!fs.existsSync(baselineEvidence)) throw new Error('PRE_BASELINE_EVIDENCE does not exist');
  const receipt = JSON.parse(fs.readFileSync(baselineEvidence, 'utf8'));
  if (receipt.exitCode !== 0 || !Array.isArray(receipt.passed) || receipt.failed?.length) throw new Error('PRE_BASELINE_EVIDENCE is not a green baseline receipt');
  baselinePassed = receipt.passed;
}
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-preimplementation-')));
const runRoot = path.join(directory, 'allowed');
const deniedRoot = path.join(directory, 'denied');
fs.mkdirSync(runRoot);
fs.mkdirSync(deniedRoot);
fs.writeFileSync(path.join(deniedRoot, 'sentinel.txt'), 'synthetic private sentinel');
const tests = path.join(root, 'tests/preimplementation/application-modules');
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
const args = [...Object.entries(params).flatMap(([key, value]) => ['-D', `${key}=${value}`]), '-f', path.join(tests, 'configs/node.sbp'), process.execPath, '--experimental-loader', path.join(tests, 'drivers/baseline-loader.mjs'), path.join(tests, 'cases', pack + '.case.mjs')];
const result = spawnSync('/usr/bin/sandbox-exec', args, {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000,
  maxBuffer: 12 * 1024 * 1024,
  env: {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
    NODE_ENV: 'test',
    TZ: 'UTC',
    PRE_PACK: pack,
    PRE_TOOLCHAIN_ROOT: toolRoot,
    PRE_RUN_ROOT: runRoot,
    PRE_DENIED_ROOT: deniedRoot,
    PRE_TARGET: process.env.PRE_TARGET || 'baseline',
    ...(process.env.PRE_CANDIDATE_GRATITUDE_DRIVER ? { PRE_CANDIDATE_GRATITUDE_DRIVER: process.env.PRE_CANDIDATE_GRATITUDE_DRIVER } : {}),
    ...(process.env.PRE_CANDIDATE_BROWSER_DRIVER ? { PRE_CANDIDATE_BROWSER_DRIVER: process.env.PRE_CANDIDATE_BROWSER_DRIVER } : {}),
    ...(baselineEvidence ? { PRE_BASELINE_EVIDENCE: baselineEvidence } : {}),
    ...(mutation ? {
      PRE_MUTATION: mutation
    } : {}),
    TMPDIR: runRoot,
    XDG_CACHE_HOME: path.join(runRoot, 'cache')
  }
});
const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(directory, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
const output = clean(result.stdout);
const error = clean(result.stderr);
const sandboxSetupFailure = /sandbox_apply:\s*Operation not permitted/i.test(error) ? {
  state: 'host-denied',
  detail: 'macOS refused to apply the required sandbox before the selected case process started',
  nextAction: 'Restore or approve sandbox-exec capability; do not bypass the profile or run the case directly.'
} : null;
const passes = [...output.matchAll(/^ok \d+ - (CASE-[^\n]+)/gm)].map(m => m[1]).filter(title=>!/# (SKIP|TODO)\b/i.test(title));
const failures = [...output.matchAll(/^not ok \d+ - (CASE-[^\n]+)/gm)].map(m => m[1]);
const incompleteCounts=Object.fromEntries(['skipped','todo','cancelled'].map(key=>[key,Number(output.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]||0)]));
const incomplete=Object.values(incompleteCounts).some(Boolean);
const violationFiles = fs.readdirSync(deniedRoot).filter(name => name !== 'sentinel.txt');
const evidenceDir = path.join(packet, 'evidence');
fs.mkdirSync(evidenceDir, {
  recursive: true
});
const inputFiles = fs.readdirSync(tests, {
  recursive: true
}).filter(name => fs.lstatSync(path.join(tests, name)).isFile() && (name.startsWith('drivers/') || name === 'configs/node.sbp' || name === 'cases/' + pack + '.case.mjs' || name === 'tooling/run-node.mjs' || name === 'tooling/census.mjs')).sort();
const mutationDetected = mutation ? result.status === 1 && error.includes('"controlledMutation":"' + mutation + '"') && failures.some(name => name.startsWith(expectedFailures[mutation])) : null;
const parity = baselinePassed ? {
  state: passes.length === baselinePassed.length && passes.every((name, index) => name === baselinePassed[index]) && !failures.length && !incomplete ? 'matched' : 'mismatch',
  reference: path.relative(packet, baselineEvidence), baselinePassed: baselinePassed.length, candidatePassed: passes.length
} : { state: 'baseline-only' };
const report = {
  schema: 'daylight.preimplementation.run/v1',
  id: 'RUN-' + pack.toUpperCase() + '-' + Date.now(),
  capturedAt: new Date().toISOString(),
  pack,
  target: process.env.PRE_TARGET || 'baseline',
  baselineEvidence: baselineEvidence ? path.relative(packet, baselineEvidence) : null,
  mutation,
  mutationDetected,
  baseline: JSON.parse(fs.readFileSync(path.join(packet, 'baseline.json'))).revision,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  command: `PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-node.mjs ${pack}${mutation ? ' ' + mutation : ''}`,
  exitCode: result.status,
  signal: result.signal,
  error: clean(result.error?.message),
  setupFailure: sandboxSetupFailure,
  assertionsStarted: !sandboxSetupFailure,
  passed: passes,
  failed: failures,
  parity,
  incompleteCounts,
  unexpectedWrites: violationFiles,
  inputs: inputFiles.map(name => ({
    name,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(tests, name))).digest('hex')
  })),
  stdout: output,
  stderr: error,
  limitations: ['Dedicated test-only installed-scope dependency bridge; not future Node package resolution proof', 'No deployed household controller, actual printer, provider, token pipeline or browser was exercised', 'Raw source baseline is protected; tests and synthetic fixtures are additive', 'Mutation runs are memory-only source transforms in disposable isolated child processes, not migrated candidates']
};
const name = pack + '-' + new Date().toISOString().replaceAll(':', '-') + '.json';
fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({
  evidence: 'evidence/' + name,
  exitCode: result.status,
  passed: passes.length,
  failed: failures,
  mutation,
  mutationDetected,
  unexpectedWrites: violationFiles,
  error: clean(result.error?.message),
  setupFailure: sandboxSetupFailure
}) + '\n');
if (sandboxSetupFailure || (mutation ? !mutationDetected : result.status !== 0 || failures.length || !passes.length) || violationFiles.length || incomplete || parity.state === 'mismatch') {
  process.stdout.write(output + '\n' + error);
  process.exitCode = 1;
}
