import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Explicit local paths only; no default live origin, writable data mount or credentials.
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert.ok(['--source-root', '--tool-root', '--output-root', '--fixture', '--manifest', '--targets', '--controls-only'].includes(key), `Unknown option: ${key}`);
  assert.ok(!Object.hasOwn(options, key), `Duplicate option: ${key}`);
  if (key === '--controls-only') options[key] = true;
  else { assert.ok(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing ${key}`); options[key] = process.argv[++i]; }
}
for (const key of ['--source-root', '--tool-root', '--output-root']) assert.ok(path.isAbsolute(options[key] ?? ''), `Explicit absolute ${key} required`);
assert.equal(Boolean(options['--manifest']), Boolean(options['--targets']), '--manifest and --targets must be supplied together');
assert.ok(!options['--controls-only'] || !options['--manifest'], 'Controls do not make business requests');
const sourceRoot = fs.realpathSync(options['--source-root']);
const revision = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' });
assert.equal(revision.status, 0, 'Candidate source revision unavailable');
const sourceCommit = revision.stdout.trim();
assert.match(sourceCommit, /^[a-f0-9]{40}$/);
const toolRoot = fs.realpathSync(options['--tool-root']);
const outputRoot = fs.realpathSync(options['--output-root']);
assert.ok(outputRoot !== sourceRoot && !outputRoot.startsWith(sourceRoot + path.sep), 'Outputs must be outside source');
const directory = path.dirname(fileURLToPath(import.meta.url));
const fixtureFile = fs.realpathSync(options['--fixture'] ?? path.join(directory, 'local-app-fixture.json'));
const prepared = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const fixed = JSON.parse(fs.readFileSync(path.join(directory, 'local-app-fixture.json'), 'utf8'));
assert.ok(prepared.fixtureFiles && typeof prepared.fixtureFiles === 'object');
for (const [relative, value] of Object.entries(prepared.fixtureFiles)) {
  assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..') && /^data\/.+\.ya?ml$/.test(relative), 'Unsafe fixture path');
  const reviewedArray = /^data\/household(?:-[a-zA-Z0-9_-]+)?\/(?:finance\/transaction\.pairs|gratitude\/(?:selections|discarded)\.gratitude)\.ya?ml$/.test(relative);
  assert.ok(value && typeof value === 'object' && (!Array.isArray(value) || reviewedArray), 'Only reviewed Finance pairs or Gratitude selections/discarded data may have an array root');
}
// Keep credentials, services, integrations and devices synthetic and disabled.
for (const relative of ['data/system/config/auth.yml', 'data/system/config/services.yml', 'data/system/config/adapters.yml', 'data/system/config/bots.yml', 'data/system/secrets.yml', 'data/household/integrations.yml', 'data/household/hardware/devices.yml']) {
  assert.deepEqual(prepared.fixtureFiles[relative], fixed.fixtureFiles[relative], `Unsafe startup fixture change: ${relative}`);
}
const run = fs.mkdtempSync(path.join(outputRoot, 'daylight-local-http-'));
fs.chmodSync(run, 0o700);
const scratch = path.join(run, 'scratch'), denied = path.join(run, 'denied');
fs.mkdirSync(scratch); fs.mkdirSync(denied);
fs.writeFileSync(path.join(denied, 'private.env'), 'synthetic private sentinel\n', { mode: 0o600 });
fs.writeFileSync(path.join(scratch, 'openssl.cnf'), '');
fs.writeFileSync(path.join(scratch, 'probe-input.json'), JSON.stringify({ sourceRoot, fixtureFiles: prepared.fixtureFiles }), { mode: 0o600 });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const grants = new Map();
const inventory = spawnSync('/usr/bin/git', ['ls-files', '-z'], { cwd: sourceRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(inventory.status, 0, 'Tracked source enumeration failed');
const permitted = /^(backend\/(src|assets)|frontend\/src|shared|modules|capabilities)\/.+\.(mjs|js|cjs|jsx|json|ya?ml|scss|css|svg|png|jpg|jpeg|webp|txt|ttf|otf|html|glsl|glslp|musicxml|py)$/;
const blocked = /(^|\/)(\.env[^/]*|node_modules|\.git|dist|build|coverage|vendor)(\/|$)/;
for (const relative of inventory.stdout.split('\0').filter(p => permitted.test(p) && !blocked.test(p))) {
  if (relative === 'backend/src/5_composition/serverMain.mjs') continue;
  const file = path.join(sourceRoot, relative);
  if (!fs.existsSync(file)) continue;
  assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'Source must be a regular non-symlink');
  assert.equal(fs.realpathSync(file), file); grants.set(file, 'F');
  for (let dir = path.dirname(file); dir.startsWith(sourceRoot); dir = path.dirname(dir)) grants.set(dir, 'L');
}
// Same canonical dependency roots and bounded native-library discovery as existing launcher.
for (const scope of ['', 'backend', 'frontend']) {
  grants.set(fs.realpathSync(path.join(sourceRoot, scope, 'package.json')), 'F');
  grants.set(fs.realpathSync(path.join(toolRoot, scope, 'package.json')), 'F');
  grants.set(fs.realpathSync(path.join(toolRoot, scope, 'node_modules')), 'D');
}
for (const name of ['librt.so.1', 'libuuid.so.1', 'libresolv.so.2']) grants.set(fs.realpathSync('/lib/x86_64-linux-gnu/' + name), 'F');
const libraries = spawnSync('/usr/bin/ldd', ['/usr/bin/pdftotext'], { encoding: 'utf8', timeout: 5000 });
assert.equal(libraries.status, 0, 'Existing native library enumeration failed');
for (const match of libraries.stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)) grants.set(fs.realpathSync(match[1]), 'F');
const entryName = options['--controls-only'] ? 'local-http-controls.mjs' : 'local-app-probe.mjs';
for (const name of [entryName, 'transparent-loader.mjs']) {
  fs.copyFileSync(path.join(directory, name), path.join(run, name)); grants.set(path.join(run, name), 'F');
}
const manifest = path.join(run, 'read-allowlist.tsv');
assert.ok([...grants.keys()].every(file => !/[\r\n\t]/.test(file)), 'Unsafe grant path');
fs.writeFileSync(manifest, [...grants].sort().map(([file, kind]) => `${kind}\t${file}\n`).join(''));
const sourceInputs = [...grants].filter(([file, kind]) => kind === 'F').map(([file]) => ({ file, sha256: hash(file) }));
for (const file of [fileURLToPath(import.meta.url), path.join(directory, 'api-comparator.mjs'), path.join(directory, entryName), path.join(directory, 'transparent-loader.mjs'), fixtureFile, path.join(sourceRoot, 'tests/preimplementation/application-modules/tooling/landlock-runner.c'), ...['--manifest', '--targets'].filter(key => options[key]).map(key => fs.realpathSync(options[key]))]) {
  if (!sourceInputs.some(row => row.file === file)) sourceInputs.push({ file, sha256: hash(file) });
}
const c = path.join(sourceRoot, 'tests/preimplementation/application-modules/tooling/landlock-runner.c');
const binary = path.join(run, 'landlock-runner');
const compile = spawnSync('/usr/bin/gcc', ['-O2', '-Wall', '-Wextra', '-Werror', c, '-o', binary], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
assert.equal(compile.status, 0, compile.stderr);
const args = [scratch, fs.realpathSync(process.execPath), manifest, toolRoot, path.join(run, 'transparent-loader.mjs'), path.join(run, entryName), denied, 'readiness-http', 'baseline', ''];
const child = spawn('/usr/bin/timeout', ['--signal=KILL', '75s', binary, ...args], { cwd: scratch, env: { PATH: '/usr/bin:/bin' } });
let stderr = '', finished = null, comparison = null, comparisonError = null, response = null, referenceIdentityBefore = null, referenceIdentityAfter = null;
const referenceObservations = [];
child.stderr.on('data', chunk => { stderr += chunk; });
const exited = new Promise(resolve => child.on('exit', (exitCode, signal) => { finished = { exitCode, signal }; resolve(finished); }));
for (let attempt = 0; attempt < 400 && !finished; attempt++) {
  if (fs.existsSync(path.join(scratch, 'ready.json'))) {
    console.log(JSON.stringify({ ready: path.join(scratch, 'ready.json'), url: 'http://127.0.0.1:43129', receipt: path.join(run, 'receipt.json') }));
    try {
      if (options['--controls-only']) {
        const result = await fetch('http://127.0.0.1:43129/synthetic-control', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
        response = { status: result.status, header: result.headers.get('x-control'), body: await result.text() };
        assert.deepEqual(response, { status: 200, header: 'actual-http', body: 'synthetic transport bytes\n' });
      } else if (options['--manifest']) {
        const { compareApi, fetchTransport } = await import('./api-comparator.mjs');
        const expectations = JSON.parse(fs.readFileSync(options['--manifest'], 'utf8'));
        const targets = JSON.parse(fs.readFileSync(options['--targets'], 'utf8'));
        assert.equal(targets.candidate.sourceCommit, sourceCommit, 'Declared candidate revision must match actual HEAD');
        if (targets.mode === 'live-reference') {
          assert.equal(targets.dataRelationship?.kind, 'independent-snapshot', 'Synthetic startup isolation cannot claim a full live fixture match');
          assert.equal(targets.reference.fixtureSha256, undefined, 'Live fixture identity is not known from selected projections');
        }
        assert.equal(new URL(targets.candidate.url).origin, 'http://127.0.0.1:43129', 'Candidate must be this task-owned listener');
        targets.candidate.workingTreeSha256 = jsonHash(sourceInputs.filter(row => row.file.startsWith(sourceRoot + path.sep)).map(row => ({ path: path.relative(sourceRoot, row.file).split(path.sep).join('/'), sha256: row.sha256 })).sort((a, b) => a.path.localeCompare(b.path)));
        targets.candidate.fixtureSha256 = jsonHash(prepared.fixtureFiles);
        const observeReference = async () => {
          assert.equal(targets.readOnlyReference, true);
          const origin = new URL(targets.reference.url);
          assert.equal(origin.protocol, 'http:');
          assert.ok(['127.0.0.1', '[::1]'].includes(origin.hostname));
          assert.ok(origin.port && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash);
          assert.notEqual(origin.origin, new URL(targets.candidate.url).origin);
          const response = await fetchTransport({ url: new URL('/build.txt', origin).href, method: 'GET' });
          assert.equal(response.status, 200, 'Live build provenance unavailable');
          const match = String(response.body).match(/^Commit:\s+(?:https:\/\/github\.com\/kckern\/DaylightStation\/commit\/)?([a-f0-9]{40})\s*$/m);
          assert.ok(match, 'Live source provenance must be explicit');
          const observation = { sourceCommit: match[1], observedAt: new Date().toISOString() };
          referenceObservations.push(observation);
          assert.equal(match[1], targets.reference.sourceCommit, 'Live source differs from declared reference');
          return observation;
        };
        if (targets.mode === 'live-reference') referenceIdentityBefore = await observeReference();
        comparison = await compareApi({ manifest: expectations, targets, transport: fetchTransport });
        if (targets.mode === 'live-reference') {
          referenceIdentityAfter = await observeReference();
          assert.equal(referenceIdentityBefore.sourceCommit, referenceIdentityAfter.sourceCommit, 'Live source changed during pack');
        }
        fs.writeFileSync(path.join(run, 'comparison.json'), JSON.stringify(comparison, null, 2), { mode: 0o600 });
      }
    } catch (error) { comparisonError = { name: error.name, evidence: path.join(run, 'request-error.txt') }; fs.writeFileSync(path.join(run, 'request-error.txt'), error.stack, { mode: 0o600 }); }
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}
const terminal = await exited;
const output = fs.existsSync(path.join(scratch, 'result.txt')) ? fs.readFileSync(path.join(scratch, 'result.txt'), 'utf8') : '';
const resultPath = path.join(scratch, options['--controls-only'] ? 'controls.json' : 'boot-result.json');
const proof = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
const cControls = ['socket(AF_UNIX): EPERM', 'anonymous IPC pair: permitted', 'non-TCP protocol: EPERM', 'socketpair: EPERM', 'ptrace: EPERM', 'mount: EPERM', 'unshare: EPERM'].every(marker => output.includes(marker));
const required = ['private read', 'host read', 'source write', 'other TCP bind', 'AF_UNIX socket', 'outbound TCP connect', 'exact loopback TCP bind', 'actual HTTP response'];
const controls = cControls && (options['--controls-only'] ? required.every(name => proof?.controls?.includes(name)) : ['private read', 'host read', 'source write'].every(name => output.includes(`BOOT CONTROL ${name}: denied`)));
const protectedInputsUnchanged = sourceInputs.every(row => hash(row.file) === row.sha256);
const completed = terminal.exitCode === 0 && proof?.completed === true && controls && protectedInputsUnchanged && !comparisonError;
const receipt = { sourceCommit, referenceObservations, referenceIdentityBefore, referenceIdentityAfter, executionInputs:sourceInputs.filter(row=>[fileURLToPath(import.meta.url),path.join(directory,'api-comparator.mjs'),path.join(directory,entryName),path.join(directory,'transparent-loader.mjs'),fixtureFile,c,...['--manifest','--targets'].filter(key=>options[key]).map(key=>fs.realpathSync(options[key]))].includes(row.file)), schema: 'local-app-result-v1', readinessAccepted: false, scope: options['--controls-only'] ? 'Synthetic networking controls' : 'Actual assembled application, synthetic configuration, finite reviewed HTTP cases only', ...terminal, completed, controls, protectedInputsUnchanged, comparisonAccepted: comparison?.accepted ?? null, comparisonPath: comparison ? path.join(run, 'comparison.json') : null, comparisonError, proof, response, output, stderr, sourceInputs, fixtureSha256: jsonHash(prepared.fixtureFiles), launcherSha256: hash(c), limits: { port: 43129, bindAddress: '127.0.0.1', addressSpaceGiB: 16, heapMiB: 1024, cpuSeconds: 180, alarmSeconds: 180, wallSeconds: 75, listenerSeconds: 30, fileMiB: 4, descriptors: 128 }, exclusions: ['Landlock constrains port, not bind address; audited driver binds loopback', 'Outbound TCP and standalone Unix sockets denied; existing anonymous IPC allowed', 'Scheduler/MQTT disabled; remaining real timers bounded', 'No production entrypoint, Docker, denied-role auth, live provider or natural shutdown proof'] };
fs.writeFileSync(path.join(run, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ receipt: path.join(run, 'receipt.json'), ...terminal, completed, controls, protectedInputsUnchanged, comparisonAccepted: receipt.comparisonAccepted, comparisonError }));
if (!completed || comparison?.accepted === false) process.exitCode = 1;
