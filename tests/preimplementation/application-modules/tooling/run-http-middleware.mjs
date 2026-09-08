/** Exact memory-only middleware suite; effect isolation precedes source imports. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, packet } from './census.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const testRoot = path.join(root, 'tests/preimplementation/application-modules');
const manifestPath = path.join(testRoot, 'fixtures/http-middleware.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const mutation = process.argv[2] || null;
assert.ok(process.argv.length <= 3 && (!mutation || Object.hasOwn(manifest.mutations, mutation)), 'No arbitrary selection or mutation accepted');
assert.equal(manifest.caseIds.length, 37); assert.equal(new Set(manifest.caseIds).size, 37);
const graph = JSON.parse(fs.readFileSync(path.join(packet, 'dependency-ledger.json')));
const ledger = JSON.parse(fs.readFileSync(path.join(packet, 'source-ledger.json')));
const closure = new Set(manifest.sourceSeeds), queue = [...closure];
for (let i = 0; i < queue.length; i++) for (const edge of graph.edges.filter(e => e.from === queue[i])) {
  assert.ok(!edge.kind.startsWith('unresolved'), 'Unreviewed unresolved import: ' + edge.id);
  if (edge.kind !== 'source' || closure.has(edge.target)) continue;
  assert.ok(!edge.target.startsWith('backend/src/5_composition/') && !['backend/index.js', 'backend/src/app.mjs', 'backend/src/0_system/config/index.mjs'].includes(edge.target), 'Unsafe source closure: ' + edge.target);
  closure.add(edge.target); queue.push(edge.target);
}
assert.equal(closure.size, 21);
for (const file of closure) assert.equal(hash(fs.readFileSync(path.join(root, file))), ledger.files.find(f => f.path === file)?.sha256, 'Changed protected source: ' + file);
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-http-middleware-')));
const profile = path.join(testRoot, 'configs/node.sbp'), loader = path.join(testRoot, 'drivers/baseline-loader.mjs');
const mutationLoader = path.join(testRoot, 'configs/http-mutation-loader.mjs'), testFile = path.join(testRoot, 'cases/http-middleware.case.mjs');
const params = { WORKTREE: root, RUN_ROOT: runRoot, ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'), FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), ROOT_MANIFEST: path.join(toolRoot, 'package.json'), BACKEND_MANIFEST: path.join(toolRoot, 'backend/package.json'), FRONTEND_MANIFEST: path.join(toolRoot, 'frontend/package.json') };
const args = [...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]), '-f', profile, process.execPath, '--experimental-loader', loader, '--experimental-loader', mutationLoader, testFile];
const r = spawnSync('/usr/bin/sandbox-exec', args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC', PRE_PACK: 'http-middleware', PRE_TOOLCHAIN_ROOT: toolRoot, PRE_RUN_ROOT: runRoot, ...(mutation ? { PRE_HTTP_MUTATION: mutation } : {}), TMPDIR: runRoot, XDG_CACHE_HOME: path.join(runRoot, 'cache') } });
const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
const stdout = clean(r.stdout), stderr = clean(r.stderr);
const passed = [...stdout.matchAll(/^ok \d+ - (CASE-[^\n]+)/gm)].map(m => m[1]);
const failed = [...stdout.matchAll(/^not ok \d+ - (CASE-[^\n]+)/gm)].map(m => m[1]);
const actualIds = [...passed, ...failed].map(t => t.split(' ')[0]).sort();
const incompleteCounts = Object.fromEntries(['skipped', 'todo', 'cancelled'].map(key => [key, Number(stdout.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1] || 0)]));
const summaryCount = Number(stdout.match(/^# tests (\d+)$/m)?.[1]);
const populationMatches = summaryCount === 37 && Object.values(incompleteCounts).every(n => n === 0)
  && JSON.stringify(actualIds) === JSON.stringify([...manifest.caseIds].sort())
  && ![...passed, ...failed].some(title => /# (SKIP|TODO)\b/i.test(title));
const mutationDetected = mutation ? r.status === 1 && populationMatches
  && stderr.includes('"controlledHttpMutation":"' + mutation + '"')
  && JSON.stringify(failed.map(t => t.split(' ')[0]).sort()) === JSON.stringify([...manifest.mutations[mutation].expectedFailedIds].sort()) : null;
const inputFiles = [fileURLToPath(import.meta.url), manifestPath, profile, loader, mutationLoader, testFile, path.join(testRoot, 'tooling/census.mjs'), path.join(packet, 'dependency-ledger.json'), ...[...closure].map(f => path.join(root, f))];
const report = { schema: 'daylight.preimplementation.http-middleware/v1', id: 'RUN-HTTP-MIDDLEWARE-' + Date.now(), pack: 'http-middleware', capturedAt: new Date().toISOString(), baseline: ledger.baseline, inputBase: 'repository root', inputs: inputFiles.map(f => ({ name: path.relative(root, f), sha256: hash(fs.readFileSync(f)) })), node: process.version, command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-http-middleware.mjs' + (mutation ? ' ' + mutation : ''), exitCode: r.status, signal: r.signal, passed, failed, populationMatches, incompleteCounts, mutation, mutationDetected, expectedFailedIds: mutation ? manifest.mutations[mutation].expectedFailedIds : [], sourceClosure: [...closure].sort(), stdout, stderr, limits: ['Thirty-seven memory-only cases over unchanged original middleware with fake request/response/events and actual dispatcher with in-memory transport; no server/listener/provider/private data', 'Existing preparation dependency-scope bridge remains in use; not native relocated HTTP/UUID/error-class resolution', 'Response doubles record status/json calls and JSON serialization, not Express range validation or real socket/header state', 'Four optional source transforms are in loader memory only; exact intended failing case sets and full case population required', 'Original listener-opening requestLogger/School suites, full controller ordering and candidate behavior remain separate gates'] };
const name = 'http-middleware-' + new Date().toISOString().replaceAll(':', '-') + '.json';
fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
const successful = mutation ? mutationDetected : r.status === 0 && populationMatches && failed.length === 0;
process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, exitCode: r.status, passed: passed.length, failed: failed.map(t => t.split(' ')[0]), populationMatches, mutation, mutationDetected, ...(successful ? {} : { stdout, stderr }) }) + '\n');
if (!successful) process.exitCode = 1;
