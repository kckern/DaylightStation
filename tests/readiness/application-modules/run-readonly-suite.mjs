import {validateStudyPacket} from './synthetic-study-grant.mjs';
// Explicit reviewed packs only. The proof index is an approval artifact, not discovery.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rawFixturePins, binaryFixturePins, directoryFixturePins } from './raw-utf8-fixture.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const packs = Object.freeze({ initial: 'expectations.json', next: 'next-readonly-expectations.json',
  extended: 'extended-readonly-expectations.json', reconciled: 'reconciled-readonly-expectations.json',
  feedback: 'feedback-readonly-expectations.json', calendar: 'calendar-readonly-expectations.json',
  automotive: 'automotive-readonly-expectations.json', 'health-stored': 'health-stored-readonly-expectations.json',
  'finance-stored': 'finance-stored-readonly-expectations.json', 'life-stored': 'life-stored-readonly-expectations.json',
  'school-records': 'school-records-readonly-expectations.json', 'piano-stored': 'piano-stored-readonly-expectations.json', 'school-stored': 'school-stored-readonly-expectations.json', 'fitness-stored': 'fitness-stored-readonly-expectations.json', 'language-stored': 'language-stored-readonly-expectations.json' });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const request = row => ({ id: row.id, method: row.method, path: row.path, safety: row.safety, ...(row.headers?{headers:row.headers}:{}) });

export function validateSelection(manifest, approvals, {isolatedStudyFixtureFileSha256}={}) {
  const study=isolatedStudyFixtureFileSha256!==undefined && validateStudyPacket(manifest,isolatedStudyFixtureFileSha256);
  assert.deepEqual(manifest.cases.map(row => row.id).sort(), approvals.map(row => row.id).sort(), 'Reviewed case IDs changed');
  assert.equal(new Set(approvals.map(row => row.id)).size, approvals.length, 'Duplicate approval IDs');
  for (const row of manifest.cases) {
    assert.deepEqual(request(row), request(approvals.find(approved => approved.id === row.id)), 'Unreviewed request or safety change');
    assert.deepEqual(row.safety, { reviewed: true, disposition: 'read-only', sideEffects: false, nonlocal: false, longLived: false });
    assert.equal(row.method, 'GET');
    assert.ok(row.path.startsWith('/') && !row.path.startsWith('//'));
    assert.ok(!row.body && (!row.headers || study), 'No unreviewed authentication or request bodies in this suite');
  }
}

// Exact native legacy fixture/full contract independently accepted in review28371812a4fe16f1ebcaeaecc181e7732d7cef2c221f4476eea9d848d502207c.
// Context comes only from the pair coordinator after existing native admission;
// source/runtime identity rebinds retain this fixture/contract, not historical aliases-only data.
function acceptsNativeConfigLegacy(result, approved) {
  if (approved.id !== 'config-private-content-prefixes' || approved.method !== 'GET'
      || approved.path !== '/api/v1/config/content-prefixes') return false;
  try {
    const context = result.admittedSelection, proof = context?.proof, manifest = context?.manifest;
    assert.equal(proof?.schema, 'daylight.isolated-api-pair-proof/v1');
    assert.equal(proof.reviewed, true);
    assert.equal(context.fixtureFileSha256, '66ea16f9b3305047dd4d8cec2317b3bba45c94018ff736758255259159afcae6');
    assert.equal(proof.fixtureFileSha256, context.fixtureFileSha256);
    assert.match(context.manifestFileSha256, /^[a-f0-9]{64}$/);
    assert.equal(proof.manifestFileSha256, context.manifestFileSha256);
    assert.deepEqual(result.approvals, proof.cases);
    validateSelection(manifest, proof.cases, { isolatedStudyFixtureFileSha256: context.fixtureFileSha256 });
    const contract = manifest.cases.find(c => c.id === approved.id);
    assert.equal(createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
      '57d66d9e85342f614f1b94595adc9293dba89f28dbd5db8988f826fabe04b7ba');
    return true;
  } catch { return false; }
}

export function aggregateCases(results) {
  const unique = new Map();
  let occurrences = 0;
  for (const result of results) for (const observed of result.cases) {
    const approved = result.approvals.find(row => row.id === observed.id);
    assert.ok(approved, 'Unexpected comparator case');
    const signature = JSON.stringify([approved.method, approved.path, ...(approved.headers?[approved.headers]:[])]);
    let row = unique.get(observed.id);
    if (row) assert.equal(row.signature, signature, 'Conflicting duplicate case ID');
    else { row = { id: observed.id, signature, method: approved.method, path: approved.path,
      branch: approved.branch ?? 'source-defined-unlabeled', equivalenceAccepted: true,
      independentContractAccepted: true, occurrences: [] }; unique.set(row.id, row); }
    row.equivalenceAccepted &&= observed.accepted === true;
    // These are known consumer/domain failures even if the HTTP bodies agree.
    row.independentContractAccepted &&= approved.independentContractAccepted === true
      && row.id !== 'life-feedback-period-timestamp-gap'
      && (row.id !== 'config-private-content-prefixes' || acceptsNativeConfigLegacy(result, approved));
    row.occurrences.push({ pack: result.name, accepted: observed.accepted === true,
      branch: approved.branch ?? 'source-defined-unlabeled', independentContractAccepted: approved.independentContractAccepted === true,
      errors: observed.errors ?? [], receipt: result.receipt, comparison: result.comparison });
    occurrences++;
  }
  const cases = [...unique.values()].map(({ signature, ...row }) => ({ ...row,
    correctnessAccepted: row.equivalenceAccepted && row.independentContractAccepted }));
  return { uniqueCases: cases.length, occurrences, equivalentCases: cases.filter(row => row.equivalenceAccepted).length,
    correctContractCases: cases.filter(row => row.correctnessAccepted).length,
    equivalenceAccepted: cases.length > 0 && cases.every(row => row.equivalenceAccepted),
    correctnessAccepted: cases.length > 0 && cases.every(row => row.correctnessAccepted), readinessAccepted: false,
    branches: Object.fromEntries([...new Set(cases.map(row => row.branch))].map(branch => [branch, cases.filter(row => row.branch === branch).length])), cases };
}

function guardedFile(root, relative) {
  assert.ok(typeof relative === 'string' && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'));
  const file = path.join(root, relative);
  assert.equal(fs.realpathSync(file), file, 'Canonical source files required');
  assert.ok(fs.lstatSync(file).isFile());
  return file;
}

function guardBacking(inputs, root, mediaRoot = null) {
  for (const row of inputs) {
    assert.ok([root, mediaRoot].filter(Boolean).some(allowed => row.path.startsWith(allowed + path.sep)), 'Backing input outside declared data/media roots');
    if (row.absent) { assert.ok(!fs.existsSync(row.path), 'Backing absence drift: ' + row.path); continue; }
    assert.equal(fs.realpathSync(row.path), row.path);
    const stat = fs.statSync(row.path);
    assert.equal(stat.dev, row.dev); assert.equal(stat.ino, row.ino);
    if (row.kind === 'directory') assert.deepEqual(fs.readdirSync(row.path).sort(), row.entries, 'Backing directory drift');
    else if (row.kind === 'directory-identity') assert.ok(stat.isDirectory());
    else assert.equal(hash(row.path), row.sha256, 'Backing content drift: ' + row.path);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  const required = ['source-root', 'tool-root', 'data-root', 'output-root', 'reference-url', 'reference-commit',
    'candidate-commit', 'proof-index', 'packs'];
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    assert.ok(argv[i]?.startsWith('--') && required.includes(key) && !Object.hasOwn(options, key) && argv[i + 1], 'Invalid explicit option');
    options[key] = argv[i + 1];
  }
  for (const key of required) assert.ok(options[key], 'Explicit --' + key + ' required');
  for (const key of ['source-root', 'tool-root', 'data-root', 'output-root', 'proof-index']) assert.ok(path.isAbsolute(options[key]));
  const source = fs.realpathSync(options['source-root']), data = fs.realpathSync(options['data-root']);
  const output = fs.realpathSync(options['output-root']);
  for (const root of [source, data, fs.realpathSync(options['tool-root'])]) assert.ok(output !== root && !output.startsWith(root + path.sep), 'Private output must be outside source/tool/data');
  assert.equal(fs.readdirSync(output).length, 0, 'Fresh empty output directory required');
  fs.chmodSync(output, 0o700);
  const summary = { schema: 'daylight.readonly-suite/v1', startedAt: new Date().toISOString(), readinessAccepted: false,
    scope: 'Explicit selected reviewed read-only cases; no complete route or migration readiness claim',
    reference: { url: options['reference-url'], sourceCommit: options['reference-commit'] },
    candidate: { sourceCommit: options['candidate-commit'] }, results: [], errors: [] };
  let code = 1;
  try {
    for (const key of ['reference-commit', 'candidate-commit']) assert.match(options[key], /^[a-f0-9]{40}$/);
    const origin = new URL(options['reference-url']);
    assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
    assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/');
    assert.notEqual(origin.origin, 'http://127.0.0.1:43129');
    const proof = json(options['proof-index']);
    assert.equal(proof.schema, 'daylight.readonly-suite-proof/v1');
    assert.equal(proof.candidateCommit, options['candidate-commit']);
    assert.equal(proof.referenceCommit, options['reference-commit']);
    const selected = options.packs.split(',');
    assert.equal(new Set(selected).size, selected.length, 'Duplicate selected pack');
    for (const name of selected) {
      assert.ok(Object.hasOwn(packs, name) && proof.packs[name]?.reviewed === true, 'Missing current reviewed proof for pack: ' + name);
      assert.ok(proof.packs[name].cases.length && proof.packs[name].sourceEquivalence.length, 'Incomplete reviewed pack proof');
    }
    const approvedSet = aggregateCases(selected.map(name => ({ name, approvals: proof.packs[name].cases,
      cases: proof.packs[name].cases.map(row => ({ id: row.id, accepted: true })) })));
    summary.expectedUniqueCases = approvedSet.uniqueCases;
    assert.ok(proof.sourceGuards.length, 'Explicit candidate/runtime source pins required');
    for (const file of ['run-local-app.mjs', 'api-comparator.mjs', 'local-app-probe.mjs', 'transparent-loader.mjs',
      'project-readonly-fixture.mjs', 'finance-fixture-contract.mjs', 'local-app-fixture.json', 'first-readonly-expectations.json']) {
      assert.ok(proof.sourceGuards.some(row => row.path === 'tests/readiness/application-modules/' + file), 'Missing reviewed harness pin: ' + file);
    }
    assert.ok(proof.sourceGuards.some(row => row.path === 'tests/preimplementation/application-modules/tooling/landlock-runner.c'), 'Missing sandbox pin');
    const executionHash = hash(fileURLToPath(import.meta.url));
    // Shared readers/middleware are reviewed and fingerprinted once per guard.
    const reviewedSources = [...new Map(selected.flatMap(name => proof.packs[name].sourceEquivalence)
      .map(row => [JSON.stringify([row.candidatePath, row.livePath, row.candidateSha256, row.liveSha256]), row])).values()];
    const proofHash = hash(options['proof-index']);
    const sourceGuard = () => {
      assert.equal(hash(fileURLToPath(import.meta.url)), executionHash, 'Coordinator changed during execution');
      assert.equal(hash(options['proof-index']), proofHash, 'Proof index drift');
      const head = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' });
      assert.equal(head.status, 0); assert.equal(head.stdout.trim(), proof.candidateCommit, 'Candidate revision drift');
      const inventory = spawnSync('/usr/bin/git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      assert.equal(inventory.status, 0);
      const permitted = /^(backend\/(src|assets)|frontend\/src|shared|modules|capabilities)\/.+\.(mjs|js|cjs|jsx|json|ya?ml|scss|css|svg|png|jpg|jpeg|webp|txt|ttf|otf|html|glsl|glslp|musicxml|py)$/;
      const blocked = /(^|\/)(\.env[^/]*|node_modules|\.git|dist|build|coverage|vendor)(\/|$)/;
      const runtimePaths = inventory.stdout.split('\0').filter(relative => permitted.test(relative) && !blocked.test(relative)
        && relative !== 'backend/src/5_composition/serverMain.mjs' && fs.existsSync(path.join(source, relative))).sort();
      assert.deepEqual(runtimePaths, proof.sourceGuards.map(row => row.path).filter(relative => permitted.test(relative)).sort(), 'Runtime source inventory drift');
      for (const row of proof.sourceGuards) assert.equal(hash(guardedFile(source, row.path)), row.sha256, 'Stale source proof: ' + row.path);
      for (const row of reviewedSources) {
        assert.equal(hash(guardedFile(source, row.candidatePath)), row.candidateSha256, 'Stale reviewed source');
        assert.ok(!path.isAbsolute(row.livePath) && !row.livePath.split(/[\\/]/).includes('..'));
        const blob = spawnSync('/usr/bin/git', ['show', proof.referenceCommit + ':' + row.livePath], { cwd: source, maxBuffer: 16 * 1024 * 1024 });
        assert.equal(blob.status, 0, 'Reference source unavailable');
        assert.equal(createHash('sha256').update(blob.stdout).digest('hex'), row.liveSha256, 'Stale reference source proof');
      }
    };
    const buildGuard = async () => {
      const response = await fetch(new URL('/build.txt', origin), { redirect: 'error',
        headers: { connection: 'close' }, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      assert.equal((await response.text()).match(/[a-f0-9]{40}/)?.[0], proof.referenceCommit, 'Reference build drift');
    };
    const execute = (script, args, log, timeout) => {
      const fd = fs.openSync(path.join(output, log), 'wx', 0o600);
      try { return spawnSync(process.execPath, [path.join(directory, script), ...args],
        { cwd: source, stdio: ['ignore', fd, fd], timeout, killSignal: 'SIGTERM' }); }
      finally { fs.closeSync(fd); }
    };
    sourceGuard(); await buildGuard();
    const projection = path.join(output, 'projection'); fs.mkdirSync(projection, { mode: 0o700 });
    let schoolPacket = null, fitnessPacket = null, languagePacket = null;
    if (selected.includes('school-stored')) {
      assert.ok(proof.sourceGuards.some(row => row.path === 'tests/readiness/application-modules/school-fixture-packet.mjs'), 'Missing School fixture harness pin');
      schoolPacket = path.join(projection, 'reviewed-school-packet.json');
      write(schoolPacket, proof.packs['school-stored'].fixturePacket);
    }
    if(selected.includes('fitness-stored')) {
      assert.ok(proof.sourceGuards.some(row=>row.path==='tests/readiness/application-modules/fitness-fixture-packet.mjs'));
      fitnessPacket=path.join(projection,'reviewed-fitness-packet.json');write(fitnessPacket,proof.packs['fitness-stored'].fixturePacket);
    }
    if (selected.includes('language-stored')) {
      assert.ok(proof.sourceGuards.some(row => row.path === 'tests/readiness/application-modules/language-fixture-packet.mjs'));
      languagePacket = path.join(projection, 'reviewed-language-packet.json'); write(languagePacket, proof.packs['language-stored'].fixturePacket);
    }
    const generated = execute('project-readonly-fixture.mjs', ['--data-root', data, '--output-root', projection,
      '--base-manifest', path.join(directory, 'first-readonly-expectations.json'), ...(selected.includes('piano-stored') ? ['--piano-stored', 'true'] : []), ...(schoolPacket ? ['--school-packet', schoolPacket] : []), ...(fitnessPacket ? ['--fitness-packet',fitnessPacket] : []), ...(languagePacket ? ['--language-packet', languagePacket] : [])], 'projection.log', 75000);
    assert.equal(generated.status, 0, 'Independent projection failed; see projection.log');
    const provenance = json(path.join(projection, 'provenance.json'));
    summary.proofIndexSha256 = proofHash;
    summary.backingInputCount = provenance.inputs.length;
    const contract = json(path.join(projection, 'source-contract-inputs.json'));
    summary.semanticFindings = selected.includes('life-stored') ? [{ caseId: 'life-feedback-period-timestamp-gap',
      ...contract.lifeStored.feedbackFinding }] : [];
    // Validate every selected manifest before any API case is requested.
    for (const name of selected) validateSelection(json(path.join(projection, packs[name])), proof.packs[name].cases);
    if (selected.includes('piano-stored')) {
      for (const file of ['raw-utf8-fixture.mjs', 'project-piano-fixture.py', 'http-expected-installed-route-matrix.json']) assert.ok(proof.sourceGuards.some(row => row.path === 'tests/readiness/application-modules/' + file), 'Missing Piano harness pin');
      summary.pianoStored = contract.pianoStored;
    }
    if (selected.includes('school-stored')) {
      const fixture = json(path.join(projection, 'fixture.json'));
      summary.schoolStored = contract.schoolStored;
    }
    const sortPins = rows => [...rows].sort((a, b) => a.destination.localeCompare(b.destination));
    const fixture = json(path.join(projection, 'fixture.json'));
    assert.deepEqual(sortPins(rawFixturePins(fixture)), sortPins(selected.flatMap(name => proof.packs[name].rawFixtureFiles ?? [])), 'Unreviewed UTF8 fixture bytes or destinations');
    assert.deepEqual(sortPins(binaryFixturePins(fixture)), sortPins(selected.flatMap(name => proof.packs[name].binaryFixtureFiles ?? [])), 'Unreviewed binary fixture bytes or destinations');
    assert.deepEqual(directoryFixturePins(fixture),{fixtureDirectories:selected.flatMap(name=>proof.packs[name].fixtureDirectories??[]),metadataDirectories:selected.flatMap(name=>proof.packs[name].metadataDirectories??[])},'Unreviewed directory metadata fixture');
    if(selected.includes('fitness-stored')) summary.fitnessStored=contract.fitnessStored;
    if (selected.includes('language-stored')) summary.languageStored = contract.languageStored;
    const guard = async () => { sourceGuard(); guardBacking(provenance.inputs, data, selected.includes('school-stored') ? proof.packs['school-stored'].fixturePacket.mediaRoot : selected.includes('fitness-stored') ? proof.packs['fitness-stored'].fixturePacket.mediaRoot : selected.includes('language-stored') ? proof.packs['language-stored'].fixturePacket.mediaRoot : null); await buildGuard(); };
    await guard();
    for (const name of selected) {
      await guard();
      const packOutput = path.join(output, name); fs.mkdirSync(packOutput, { mode: 0o700 });
      const targets = path.join(packOutput, 'targets.json');
      write(targets, { mode: 'live-reference', readOnlyReference: true,
        reference: { url: origin.origin, sourceCommit: proof.referenceCommit },
        candidate: { url: 'http://127.0.0.1:43129', sourceCommit: proof.candidateCommit,
          workingTreeSha256: '0'.repeat(64), fixtureSha256: '0'.repeat(64), isolated: true },
        dataRelationship: { kind: 'independent-snapshot', description: 'Fresh independently projected reviewed stored-data cases',
          selectedProjectionSha256: hash(path.join(projection, 'source-contract-inputs.json')),
          projectionProvenanceSha256: hash(path.join(projection, 'provenance.json')) } });
      const run = execute('run-local-app.mjs', ['--source-root', source, '--tool-root', options['tool-root'],
        '--output-root', packOutput, '--fixture', path.join(projection, 'fixture.json'), '--manifest', path.join(projection, packs[name]),
        '--targets', targets], name + '.log', 85000);
      const runDirs = fs.readdirSync(packOutput).filter(file => file.startsWith('daylight-local-http-'));
      const receiptPath = runDirs.length === 1 ? path.join(packOutput, runDirs[0], 'receipt.json') : null;
      const receipt = receiptPath && fs.existsSync(receiptPath) ? json(receiptPath) : null;
      const result = { name, receipt: receiptPath, comparison: receipt?.comparisonPath, exitCode: run.status,
        signal: run.signal, error: run.error?.message, controlsAccepted: !!(receipt?.completed && receipt?.controls && receipt?.protectedInputsUnchanged),
        approvals: proof.packs[name].cases.map(row => ({ ...row, branch: provenance.branches.find(branch => (branch.id ?? branch.caseId) === row.id)?.branch ?? row.branch })),
        cases: receipt?.comparisonPath && fs.existsSync(receipt.comparisonPath) ? json(receipt.comparisonPath).cases : [] };
      summary.results.push(result);
      const feedback = result.cases.find(row => row.id === 'life-feedback-period-timestamp-gap');
      if (feedback) {
        const finding = summary.semanticFindings.find(row => row.caseId === feedback.id);
        for (const role of ['reference', 'candidate']) {
          try { finding[role + 'ObservedCount'] = JSON.parse(feedback.observations[role].body).feedback.length; }
          catch { finding[role + 'ObservedCount'] = null; }
        }
        finding.correctFilteringAccepted = false;
      }
      await guard();
      assert.ok(result.controlsAccepted, 'Pack controls failed; remaining requests stopped');
      assert.deepEqual(result.cases.map(row => row.id).sort(), result.approvals.map(row => row.id).sort(), 'Incomplete comparator result');
      console.log(JSON.stringify({ pack: name, receipt: receiptPath, comparisonAccepted: receipt.comparisonAccepted }));
    }
    summary.aggregate = aggregateCases(summary.results);
    code = summary.results.every(row => row.exitCode === 0 && row.controlsAccepted) && summary.aggregate.equivalenceAccepted ? 0 : 1;
  } catch (error) { summary.errors.push(error.message + (error.cause?.message ? ': ' + error.cause.message : '')); }
  if (!summary.aggregate) summary.aggregate = aggregateCases(summary.results);
  summary.aggregate.complete = summary.aggregate.uniqueCases === summary.expectedUniqueCases && summary.errors.length === 0;
  summary.aggregate.equivalenceAccepted &&= summary.aggregate.complete;
  summary.aggregate.correctnessAccepted &&= summary.aggregate.complete;
  summary.completedAt = new Date().toISOString(); summary.exitCode = code;
  summary.executionAccepted = code === 0;
  write(path.join(output, 'suite-result.json'), summary);
  console.log(JSON.stringify({ artifact: path.join(output, 'suite-result.json'), exitCode: code,
    uniqueCases: summary.aggregate.uniqueCases, correctnessAccepted: summary.aggregate.correctnessAccepted, readinessAccepted: false }));
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
