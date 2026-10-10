import {lessonReadinessRequired,waitForPublishedUnit} from './published-unit-readiness.mjs';
import {validateStudyWindow} from './synthetic-study-grant.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateCaptureManifest, fetchTransport } from './api-comparator.mjs';
import { validateRawFixtures, validateDirectoryFixtures, materializeTimedImageFixtures } from './raw-utf8-fixture.mjs';

import { validateTestMetadata, dependencyReadGrants, assertMetadataDenied } from './runtime-test-metadata.mjs';

// Explicit local paths only; no default live origin, writable data mount or credentials.
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert.ok(['--source-root', '--tool-root', '--output-root', '--fixture', '--manifest', '--targets', '--controls-only', '--capture-role', '--pair-nonce', '--runtime-sha256', '--harness-sha256'].includes(key), `Unknown option: ${key}`);
  assert.ok(!Object.hasOwn(options, key), `Duplicate option: ${key}`);
  if (key === '--controls-only') options[key] = true;
  else { assert.ok(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing ${key}`); options[key] = process.argv[++i]; }
}
for (const key of ['--source-root', '--tool-root', '--output-root']) assert.ok(path.isAbsolute(options[key] ?? ''), `Explicit absolute ${key} required`);
const captureRole = options['--capture-role'];
assert.ok(!captureRole || ['original','candidate'].includes(captureRole));
assert.equal(Boolean(options['--manifest']), Boolean(options['--targets'] || captureRole), '--manifest requires targets or capture role');
assert.ok(!captureRole || !options['--targets'], 'Capture and live comparison are mutually exclusive');
let captureExpectations = null;
if (captureRole) {
  assert.match(options['--pair-nonce'] ?? '', /^[a-f0-9]{32}$/);
  for (const key of ['--runtime-sha256','--harness-sha256']) assert.match(options[key] ?? '', /^[a-f0-9]{64}$/);
  captureExpectations = JSON.parse(fs.readFileSync(options['--manifest'], 'utf8'));
  validateCaptureManifest(captureExpectations);
} else for(const key of ['--pair-nonce','--runtime-sha256','--harness-sha256']) assert.equal(options[key], undefined, 'Capture-only metadata');
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
const studyFixtureFileSha256=createHash('sha256').update(fs.readFileSync(fixtureFile)).digest('hex');
if(captureExpectations) {validateCaptureManifest(captureExpectations,studyFixtureFileSha256);validateStudyWindow(captureExpectations,Date.now());}
const publishedUnitRequired=captureExpectations?lessonReadinessRequired(captureExpectations,studyFixtureFileSha256):false;
const rawUTF8Files = validateRawFixtures(prepared);
const rawBinaryFiles = prepared.rawBinaryFiles ?? [];
const fixedConfigMetadata = prepared.fixedConfigMetadata ?? [];
const {fixtureDirectories, metadataDirectories} = validateDirectoryFixtures(prepared);
const fixtureIdentity = fixedConfigMetadata.length || rawUTF8Files.length || rawBinaryFiles.length || fixtureDirectories.length || metadataDirectories.length ? { fixtureFiles: prepared.fixtureFiles, rawUTF8Files, ...(fixedConfigMetadata.length ? {fixedConfigMetadata} : {}), ...(rawBinaryFiles.length ? { rawBinaryFiles } : {}), ...(fixtureDirectories.length ? {fixtureDirectories} : {}), ...(metadataDirectories.length ? {metadataDirectories} : {}) } : prepared.fixtureFiles;
const fixed = JSON.parse(fs.readFileSync(path.join(directory, 'local-app-fixture.json'), 'utf8'));
assert.ok(prepared.fixtureFiles && typeof prepared.fixtureFiles === 'object');
for (const [relative, value] of Object.entries(prepared.fixtureFiles)) {
  assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..') && /^data\/.+\.ya?ml$/.test(relative), 'Unsafe fixture path');
  // Exact disposable persisted-session fixture; native freshness tolerance is finite.
  if (relative.startsWith('data/household/gaming/arcade-game-sessions/current/')) {
    assert.equal(relative, "data/household/gaming/arcade-game-sessions/current/synthetic-readiness-panel.yml");
    assert.equal(createHash('sha256').update(JSON.stringify(prepared)).digest('hex'), 'c347b7337e6728111ac78d4ef9046b51ca788b51143065d2d9318a232f2144a9', 'Changed arcade stored-session fixture');
    assert.ok(Date.now() >= 1791645328439 && Date.now() <= 1791688528439, 'Expired arcade stored-session execution window');
  }
  const reviewedArray = /^(?:(?:data\/household(?:-[a-zA-Z0-9_-]+)?\/(?:finance\/transaction\.pairs|gratitude\/(?:selections|discarded)\.gratitude|calendar\/calendar|apps\/calendar)|data\/users\/[a-zA-Z0-9_-]+\/lifelog\/nutrition\/(?:food_catalog|observations))\.ya?ml|data\/users\/[a-zA-Z0-9_-]+\/(?:lifeplan-metrics|ceremony-records)\.yml)$/.test(relative);
  // Exact metadata recipe source only; no dataset/raw path or resolution grant.
  const reviewedRecipeArray = relative === 'data/content/school/generated-banks/recipes.yml';
  // Exact synthetic stored-array destinations only; no raw or filesystem grant.
  const reviewedStoredArray = ["data/users/user_1/apps/health/meals.yml","data/household/automotive/synthetic-array-car/service.yml","data/household/automotive/synthetic-array-car/documents.yml","data/household/automotive/log/synthetic-array-car/2026-10-01.yml","data/household/automotive/log/synthetic-array-car/2026-10-02.yml","data/household/automotive/synthetic-array-car/fuel.yml"].includes(relative);
  // Two exact synthetic arcade grant day arrays; hash binds complete ledger schema and values.
  const arcadeGrantArrayPins = {"data/users/user_1/apps/gaming/grants/2026-10-09.yml":"c71438f40925008da4e5070d976ab5747e75d28f3a121c961a51b0b5634fb416","data/users/user_1/apps/gaming/grants/2026-10-08.yml":"6fa0e644ab4c7eefc70995477104e5a09faf68b5a63899b82af7c41883c97bce"};
  const reviewedArcadeGrantArray = Object.hasOwn(arcadeGrantArrayPins, relative) && Array.isArray(value) && createHash('sha256').update(JSON.stringify(value)).digest('hex') === arcadeGrantArrayPins[relative];
  assert.ok(!Object.hasOwn(arcadeGrantArrayPins, relative) || reviewedArcadeGrantArray, 'Changed synthetic arcade grant ledger schema or values');
  assert.ok(value && typeof value === 'object' && (!Array.isArray(value) || reviewedArcadeGrantArray || reviewedArray || reviewedRecipeArray || reviewedStoredArray || ["data/users/user_1/apps/school/language/daily-korean/log/2026-10-08.yml", "data/users/user_1/apps/school/language/daily-korean/log/2026-10-09.yml", "data/users/user_2/apps/school/language/daily-korean/log/2026-10-09.yml", "data/household/school/artifacts/print/cards/1234567.yml", "data/household/school/artifacts/print/cards/7654321.yml", "data/household/school/records/curriculum-exceptions.yml"].includes(relative) || ["data/system/config/jobs.yml", "data/household/gaming/arcade-game-sessions/history/2026-10-09.yml"].includes(relative) || relative === "data/users/user_1/current/calendar.yml" || relative === "data/household/history/media-plays/2026-10-09.yml" || relative === "data/household/school/runtime/review/synthetic-review-session.yml" || ["data/household/school/records/print/jobs.yml", "data/household/school/runtime/queues/print.yml"].includes(relative)), 'Only reviewed stored-data or exact School recipes paths may have an array root');
}
// Explicit runtime timezone matches the reviewed deployment/config contract.
const runtimeTimezone = prepared.fixtureFiles['data/system/config/system.yml']?.timezone;
assert.ok(typeof runtimeTimezone === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(runtimeTimezone), 'Explicit supported fixture timezone required');
new Intl.DateTimeFormat('en-US', { timeZone: runtimeTimezone }).format(0);
// Keep credentials, services, integrations and devices synthetic and disabled.
for (const relative of ['data/system/config/auth.yml', 'data/system/config/services.yml', 'data/system/config/adapters.yml', 'data/system/config/bots.yml', 'data/system/secrets.yml', 'data/household/integrations.yml', 'data/household/hardware/devices.yml']) {
  // Exact synthetic descriptors only: no capabilities, providers, hosts, auth or activation.
  const reviewedHouseholdDeviceImages = relative === 'data/household/hardware/devices.yml' && JSON.stringify(prepared.fixtureFiles[relative]) === "{\"devices\":{\"synthetic-reading-tablet\":{\"type\":\"readiness-metadata\",\"label\":\"Reading Tablet\",\"enabled\":false,\"room\":\"study\"},\"synthetic-piano-display\":{\"type\":\"readiness-metadata\",\"label\":\"Piano Display\",\"enabled\":false,\"room\":\"music\"},\"synthetic-kitchen-audio\":{\"type\":\"readiness-metadata\",\"label\":\"Kitchen Audio\",\"enabled\":false,\"room\":\"kitchen\"},\"synthetic-hall-sensor\":{\"type\":\"readiness-metadata\",\"enabled\":false,\"room\":\"hall\",\"threshold\":2.5}}}" && createHash('sha256').update(JSON.stringify(prepared)).digest('hex') === '0734cf9f772fae34ad902de6c938cfc084b847c277b7d143b11e1f3778231734';
  const reviewedMetadataDevices = relative === 'data/household/hardware/devices.yml' && JSON.stringify(prepared.fixtureFiles[relative]) === "{\"devices\":{\"synthetic-reading-panel\":{\"type\":\"readiness-metadata\",\"name\":\"Reading Panel\",\"location\":\"Reading Room\",\"icon\":\"book\"},\"synthetic-fitness-panel\":{\"type\":\"readiness-metadata\",\"name\":\"Movement Panel\",\"location\":\"Exercise Room\",\"icon\":\"fitness\"}}}" && createHash('sha256').update(JSON.stringify(prepared)).digest('hex') === '17806e1d1d5a096f8b9dc08b9e946ef581e4cf96621c360f83c7a79f30bc1018';
  const reviewedInertWeeklyImmich = relative === 'data/system/config/services.yml' && JSON.stringify(prepared.fixtureFiles[relative]) === "{\"immich\":{\"readiness\":\"http://readiness-immich.invalid:9\"}}" && JSON.stringify(prepared.fixtureFiles['data/household/auth/immich.yml']) === "{\"token\":\"SYNTHETIC-READINESS-IMMICH-NOT-A-REAL-TOKEN\"}" && createHash('sha256').update(JSON.stringify(prepared)).digest('hex') === '6624753a47feb863894060de1d18757ed5cde3af10560e59a7b59d4f5d01386f';
  const reviewedInertAdminMetadata = relative === 'data/household/integrations.yml' && JSON.stringify(prepared.fixtureFiles[relative]) === "{\"readiness_catalogs\":[{\"provider\":\"synthetic-library\",\"enabled\":false,\"label\":\"Family Library\"},{\"provider\":\"synthetic-calendar\",\"enabled\":false,\"label\":\"Family Calendar\"},{\"provider\":\"synthetic-reading\",\"enabled\":false,\"label\":\"Reading Shelf\"}]}" && createHash('sha256').update(JSON.stringify(prepared)).digest('hex') === 'a560a0bd7d863c7e4b8a27d7882b3584feda76121c1140c6ad10b2e00942b230';
  // Exact private native metadata packet; binds complete fixture and both startup records.
  const reviewedDeviceMetadata5 = ["data/household/hardware/devices.yml", "data/system/config/adapters.yml"].includes(relative) && createHash("sha256").update(JSON.stringify(prepared)).digest("hex") === "960c8bacee350a20f5c986b054c8f0637fead3a81df4dc99e46b4f685ae30836" && JSON.stringify(prepared.fixtureFiles["data/household/hardware/devices.yml"]) === "{\"devices\":{\"synthetic-camera-entry\":{\"type\":\"ip-camera\",\"host\":\"readiness-camera.invalid\",\"manufacturer\":\"Synthetic\",\"model\":\"Metadata A\"},\"synthetic-camera-defaults\":{\"type\":\"ip-camera\",\"host\":\"readiness-camera-defaults.invalid\"}}}" && JSON.stringify(prepared.fixtureFiles["data/system/config/adapters.yml"]) === "{\"thermal_printers\":{\"synthetic-front\":{\"host\":\"readiness-printer.invalid\",\"default\":true},\"synthetic-back\":{\"host\":\"readiness-back-printer.invalid\",\"port\":9200},\"synthetic-nohost\":{\"default\":false}}}";
  // Exact merged status/models fixture identity; native device admission retained.
  const reviewedModelsMetadata = relative === "data/system/secrets.yml" && JSON.stringify(prepared.fixtureFiles[relative]) === "{\"SYNTHETIC_READINESS_MODELS_TOKEN\":\"SYNTHETIC-READINESS-MODELS-METADATA-NOT-A-REAL-CREDENTIAL\"}" && createHash("sha256").update(JSON.stringify(prepared)).digest("hex") === "d6aa30907e9b1b222f473608aa995c45d39b11348b39290c59538e20d3940091";
  // Independently reviewed Fitness5 + FinanceSync2 native constructor metadata; exact entire fixture identity.
  const reviewedFitnessFinance7 = ["data/household/hardware/devices.yml", "data/household/integrations.yml"].includes(relative) && createHash("sha256").update(JSON.stringify(prepared)).digest("hex") === "898615a3ff72944a67d70458653c1899b7cb816cd362dcb78770f5bd262e02a5" && JSON.stringify(prepared.fixtureFiles["data/household/hardware/devices.yml"]) === "{\"devices\":{\"synthetic-retroarch-file-metadata\":{\"type\":\"readiness-metadata\",\"enabled\":false,\"file_server\":{\"host\":\"readiness-retroarch.invalid\",\"port\":9}}}}" && JSON.stringify(prepared.fixtureFiles["data/household/integrations.yml"]) === "{\"homeassistant\":{\"baseUrl\":\"http://readiness-ha.invalid:9\",\"token\":\"SYNTHETIC-READINESS-HA-NOT-A-REAL-TOKEN\"}}";
  if (!reviewedFitnessFinance7 && !reviewedModelsMetadata && !reviewedDeviceMetadata5 && !reviewedHouseholdDeviceImages && !reviewedInertAdminMetadata && !reviewedMetadataDevices && !reviewedInertWeeklyImmich) assert.deepEqual(prepared.fixtureFiles[relative], fixed.fixtureFiles[relative], `Unsafe startup fixture change: ${relative}`);
}
const run = fs.mkdtempSync(path.join(outputRoot, 'daylight-local-http-'));
fs.chmodSync(run, 0o700);
const scratch = path.join(run, 'scratch'), denied = path.join(run, 'denied');
fs.mkdirSync(scratch); fs.mkdirSync(denied);
materializeTimedImageFixtures(prepared, scratch);
fs.writeFileSync(path.join(denied, 'private.env'), 'synthetic private sentinel\n', { mode: 0o600 });
fs.writeFileSync(path.join(scratch, 'openssl.cnf'), '');
fs.writeFileSync(path.join(scratch, 'probe-input.json'), JSON.stringify({ sourceRoot, fixtureFiles: prepared.fixtureFiles, rawUTF8Files, rawBinaryFiles, fixtureDirectories, metadataDirectories, fixedConfigMetadata }), { mode: 0o600 });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const grants = new Map();
const testMetadata=validateTestMetadata(toolRoot);
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
  for(const [file,kind] of dependencyReadGrants(fs.realpathSync(path.join(toolRoot, scope, 'node_modules')),testMetadata)) grants.set(file,kind);
}
for (const name of ['librt.so.1', 'libuuid.so.1', 'libresolv.so.2']) grants.set(fs.realpathSync('/lib/x86_64-linux-gnu/' + name), 'F');
const libraries = spawnSync('/usr/bin/ldd', ['/usr/bin/pdftotext'], { encoding: 'utf8', timeout: 5000 });
assert.equal(libraries.status, 0, 'Existing native library enumeration failed');
for (const match of libraries.stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)) grants.set(fs.realpathSync(match[1]), 'F');
const entryName = options['--controls-only'] ? 'local-http-controls.mjs' : 'local-app-probe.mjs';
for (const name of [entryName, 'transparent-loader.mjs']) {
  fs.copyFileSync(path.join(directory, name), path.join(run, name)); grants.set(path.join(run, name), 'F');
}
assertMetadataDenied([...grants],testMetadata);
const manifest = path.join(run, 'read-allowlist.tsv');
assert.ok([...grants.keys()].every(file => !/[\r\n\t]/.test(file)), 'Unsafe grant path');
fs.writeFileSync(manifest, [...grants].sort().map(([file, kind]) => `${kind}\t${file}\n`).join(''));
const sourceInputs = [...grants].filter(([file, kind]) => kind === 'F').map(([file]) => ({ file, sha256: hash(file) }));
const workingTreeSha256 = jsonHash(sourceInputs.filter(row=>row.file.startsWith(sourceRoot+path.sep)).map(row=>({path:path.relative(sourceRoot,row.file).split(path.sep).join('/'),sha256:row.sha256})).sort((a,b)=>a.path.localeCompare(b.path)));
for (const file of [fileURLToPath(import.meta.url), path.join(directory, 'api-comparator.mjs'), path.join(directory, 'published-unit-readiness.mjs'), path.join(directory, 'raw-utf8-fixture.mjs'), path.join(directory, 'runtime-test-metadata.mjs'), path.join(directory, entryName), path.join(directory, 'transparent-loader.mjs'), fixtureFile, path.resolve(directory, '../../preimplementation/application-modules/tooling/landlock-runner.c'), ...['--manifest', '--targets'].filter(key => options[key]).map(key => fs.realpathSync(options[key]))]) {
  if (!sourceInputs.some(row => row.file === file)) sourceInputs.push({ file, sha256: hash(file) });
}
const c = path.resolve(directory, '../../preimplementation/application-modules/tooling/landlock-runner.c');
const binary = path.join(run, 'landlock-runner');
const compile = spawnSync('/usr/bin/gcc', ['-O2', '-Wall', '-Wextra', '-Werror', c, '-o', binary], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
assert.equal(compile.status, 0, compile.stderr);
const args = [scratch, fs.realpathSync(process.execPath), manifest, toolRoot, path.join(run, 'transparent-loader.mjs'), path.join(run, entryName), denied, 'readiness-http', 'baseline', ''];
const captureStartedAt = Date.now();
let captured = null, publishedUnitReadiness;
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
      } else if (captureRole) {
        if(publishedUnitRequired) publishedUnitReadiness=await waitForPublishedUnit({manifest:captureExpectations,fixtureFileSha256:studyFixtureFileSha256,role:captureRole,transport:fetchTransport,persist:evidence=>fs.writeFileSync(path.join(run,'published-unit-readiness.json'),JSON.stringify(evidence,null,2),{mode:0o600})});
        captured = [];
        for (const c of captureExpectations.cases) {
          const url = new URL(c.path, 'http://127.0.0.1:43129').href;
          validateStudyWindow(captureExpectations,Date.now());
          captured.push({ id:c.id,method:c.method,path:c.path,url,bodyKind:c.expected.body.kind, ...(Object.hasOwn(c,'headers')?{headers:c.headers}:{}),
            observed:await fetchTransport({url,method:c.method,bodyKind:c.expected.body.kind,caseId:c.id,...(Object.hasOwn(c,'headers')?{headers:c.headers}:{}),manifestSha256:jsonHash(captureExpectations),fixtureFileSha256:studyFixtureFileSha256,captureRole}) });
        }
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
        targets.candidate.fixtureSha256 = jsonHash(fixtureIdentity);
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
const required = ['private read', 'host read', 'source write', 'test results cache read', 'other TCP bind', 'AF_UNIX socket', 'outbound TCP connect', 'exact loopback TCP bind', 'actual HTTP response'];
const controls = cControls && (options['--controls-only'] ? required.every(name => proof?.controls?.includes(name)) : ['private read', 'host read', 'source write', 'test results cache read'].every(name => output.includes(`BOOT CONTROL ${name}: denied`)));
const protectedInputsUnchanged = sourceInputs.every(row => hash(row.file) === row.sha256);
const completed = terminal.exitCode === 0 && proof?.completed === true && controls && protectedInputsUnchanged && !comparisonError;
let capture = null;
if (captureRole && captured) {
  validateStudyWindow(captureExpectations,Date.now());
  const record = {schema:'isolated-api-capture-v1', role:captureRole, pairNonce:options['--pair-nonce'],sourceCommit,
    workingTreeSha256,
    runtimeSha256:options['--runtime-sha256'],harnessSha256:options['--harness-sha256'],
    fixtureFileSha256:hash(fixtureFile),fixtureSha256:jsonHash(fixtureIdentity),runtimeTimezone,
    manifestSha256:jsonHash(captureExpectations),url:'http://127.0.0.1:43129',
    startedAt:captureStartedAt,endedAt:Date.now(),...(publishedUnitReadiness?{publishedUnitReadiness}:{}),cases:captured};
  const file=path.join(run,'capture.json');
  fs.writeFileSync(file,JSON.stringify(record,null,2),{mode:0o600,flag:'wx'});
  const {cases,...metadata}=record;capture={...metadata,file,sha256:hash(file)};
}
const receipt = { capture, sourceCommit, runtimeTimezone, referenceObservations, referenceIdentityBefore, referenceIdentityAfter, executionInputs:sourceInputs.filter(row=>[fileURLToPath(import.meta.url),path.join(directory,'api-comparator.mjs'),path.join(directory,'published-unit-readiness.mjs'),path.join(directory,entryName),path.join(directory,'transparent-loader.mjs'),fixtureFile,c,...['--manifest','--targets'].filter(key=>options[key]).map(key=>fs.realpathSync(options[key]))].includes(row.file)), schema: 'local-app-result-v1', readinessAccepted: false, scope: options['--controls-only'] ? 'Synthetic networking controls' : 'Actual assembled application, synthetic configuration, finite reviewed HTTP cases only', ...terminal, completed, controls, protectedInputsUnchanged, comparisonAccepted: comparison?.accepted ?? null, comparisonPath: comparison ? path.join(run, 'comparison.json') : null, comparisonError, proof, response, output, stderr, sourceInputs, fixtureSha256: jsonHash(fixtureIdentity), launcherSha256: hash(c), limits: { port: 43129, bindAddress: '127.0.0.1', addressSpaceGiB: 16, heapMiB: 1024, cpuSeconds: 180, alarmSeconds: 180, wallSeconds: 75, listenerSeconds: 30, fileMiB: 4, descriptors: 128 }, exclusions: ['Landlock constrains port, not bind address; audited driver binds loopback', 'Outbound TCP and standalone Unix sockets denied; existing anonymous IPC allowed', 'Scheduler/MQTT disabled; remaining real timers bounded', 'No production entrypoint, Docker, denied-role auth, live provider or natural shutdown proof'] };
fs.writeFileSync(path.join(run, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ receipt: path.join(run, 'receipt.json'), ...terminal, completed, controls, protectedInputsUnchanged, comparisonAccepted: receipt.comparisonAccepted, comparisonError }));
if (!completed || comparison?.accepted === false) process.exitCode = 1;
