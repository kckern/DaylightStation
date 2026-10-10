import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { aggregateCases, validateSelection, main } from './run-readonly-suite.mjs';

test('duplicates preserve every occurrence and any failed comparison', () => {
  const approved = { id: 'a', method: 'GET', path: '/a', branch: 'populated', independentContractAccepted: true };
  const result = aggregateCases([{ name: 'first', approvals: [approved], cases: [{ id: 'a', accepted: true }] },
    { name: 'second', approvals: [approved], cases: [{ id: 'a', accepted: false, errors: ['mismatch'] }] }]);
  assert.equal(result.uniqueCases, 1);
  assert.equal(result.occurrences, 2);
  assert.equal(result.equivalenceAccepted, false);
  assert.equal(result.correctContractCases, 0);
  assert.equal(result.cases[0].occurrences[1].errors[0], 'mismatch');
  assert.throws(() => aggregateCases([{ approvals: [approved], cases: [{ id: 'a', accepted: true }] },
    { approvals: [{ ...approved, path: '/b' }], cases: [{ id: 'a', accepted: true }] }]), /Conflicting duplicate/);
});

test('stale source proof writes a failed artifact before any network request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-suite-control-'));
  const output = path.join(root, 'output'); fs.mkdirSync(output);
  const data = path.join(root, 'data'); fs.mkdirSync(data);
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const commit = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).stdout.trim();
  const proof = path.join(root, 'proof.json');
  const sourceGuards = ['run-local-app.mjs', 'api-comparator.mjs', 'local-app-probe.mjs', 'transparent-loader.mjs',
    'project-readonly-fixture.mjs', 'finance-fixture-contract.mjs', 'local-app-fixture.json', 'first-readonly-expectations.json']
    .map(file => ({ path: 'tests/readiness/application-modules/' + file, sha256: '0'.repeat(64) }));
  sourceGuards.push({ path: 'tests/preimplementation/application-modules/tooling/landlock-runner.c', sha256: '0'.repeat(64) });
  fs.writeFileSync(proof, JSON.stringify({ schema: 'daylight.readonly-suite-proof/v1', candidateCommit: commit,
    referenceCommit: '0'.repeat(40), sourceGuards,
    packs: { 'finance-stored': { reviewed: true, sourceEquivalence: [{}], cases: [{ id: 'a', method: 'GET', path: '/a' }] } } }));
  const previous = globalThis.fetch; let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('Network must not be reached'); };
  try {
    const code = await main(['--source-root', source, '--tool-root', source, '--data-root', data,
      '--output-root', output, '--reference-url', 'http://127.0.0.1:3111', '--reference-commit', '0'.repeat(40),
      '--candidate-commit', commit, '--proof-index', proof, '--packs', 'finance-stored']);
    assert.equal(code, 1);
    assert.equal(requests, 0);
    const artifact = JSON.parse(fs.readFileSync(path.join(output, 'suite-result.json')));
    assert.equal(artifact.executionAccepted, false);
    assert.equal(artifact.aggregate.equivalenceAccepted, false);
    assert.match(artifact.errors[0], /Runtime source inventory drift/);
  } finally { globalThis.fetch = previous; fs.rmSync(root, { recursive: true, force: true }); }
});

test('baseline semantic failure never earns correctness credit', () => {
  const result = aggregateCases([{ name: 'life-stored', approvals: [{ id: 'life-feedback-period-timestamp-gap',
    method: 'GET', path: '/feedback', branch: 'baseline-semantic-failure', independentContractAccepted: false }],
    cases: [{ id: 'life-feedback-period-timestamp-gap', accepted: true }] }]);
  assert.equal(result.equivalenceAccepted, true);
  assert.equal(result.correctnessAccepted, false);
  assert.equal(result.correctContractCases, 0);
  assert.equal(result.readinessAccepted, false);
});

test('selection cannot discover routes or change reviewed request safety', () => {
  const safety = { reviewed: true, disposition: 'read-only', sideEffects: false, nonlocal: false, longLived: false };
  const approved = [{ id: 'a', method: 'GET', path: '/a', safety }];
  validateSelection({ cases: approved }, approved);
  assert.throws(() => validateSelection({ cases: [{ ...approved[0], path: '/new' }] }, approved), /Unreviewed/);
  assert.throws(() => validateSelection({ cases: [{ ...approved[0], safety: { ...safety, sideEffects: true } }] }, approved), /Unreviewed/);
  assert.throws(() => validateSelection({ cases: [] }, approved), /case IDs/);
});

// Exact full Config case accepted in review28371812...; self-contained unit metadata, no saved-capture filesystem dependency.
const configManifest = {"schema":"comparator-v1","cases":[{"id":"config-private-content-prefixes","method":"GET","path":"/api/v1/config/content-prefixes","safety":{"reviewed":true,"disposition":"read-only","sideEffects":false,"nonlocal":false,"longLived":false},"expected":{"status":200,"headers":{"content-type":"application/json; charset=utf-8","content-length":"418","etag":"W/\"1a2-3YjPUBJKm+mhiGlnsN84D9PL7Ag\""},"body":{"kind":"json","required":{"aliases":"object","storagePaths":"object","legacy":"object"},"equals":{"aliases":{"hymn":"singalong:hymn","primary":"singalong:primary","scripture":"readalong:scripture","scriptures":"readalong:scripture","poem":"readalong:poetry"},"storagePaths":{"hymn":"hymn","primary":"hymn","scripture":"scriptures","poetry":"poetry","talks":"talk"},"legacy":{"hymn":"singalong:hymn","primary":"singalong:primary","scripture":"readalong:scripture","talk":"readalong:talks","poem":"readalong:poetry"}}}},"normalize":{"jsonPaths":[],"headers":["date","connection","keep-alive"]},"expectationSource":"Independent complete authored native config and guest fresh-state contract; no product projection oracle or capture"}]};
const configProof = {schema:'daylight.isolated-api-pair-proof/v1', reviewed:true, cases:[{"id":"config-private-content-prefixes","method":"GET","path":"/api/v1/config/content-prefixes","safety":{"reviewed":true,"disposition":"read-only","sideEffects":false,"nonlocal":false,"longLived":false},"branch":"Native full household prefixes YAML read with independently authored documented legacy map","independentContractAccepted":true,"urlTemplate":"/api/v1/config/content-prefixes"}], fixtureFileSha256:'66ea16f9b3305047dd4d8cec2317b3bba45c94018ff736758255259159afcae6', manifestFileSha256:createHash('sha256').update(JSON.stringify(configManifest)).digest('hex')};
const nativeConfigResult = () => ({name:'unit-config-context', approvals:structuredClone(configProof.cases), cases:[{id:'config-private-content-prefixes', accepted:true}], admittedSelection:{proof:structuredClone(configProof), manifest:structuredClone(configManifest), fixtureFileSha256:configProof.fixtureFileSha256, manifestFileSha256:configProof.manifestFileSha256}});

test('reviewed Config legacy full contract accepts only the bound native selection', () => {
  const result = aggregateCases([nativeConfigResult()]);
  assert.equal(result.correctContractCases, 1);
  assert.equal(result.correctnessAccepted, true);
  assert.equal(result.readinessAccepted, false);
  // Source/runtime checkpoint rebinding does not change reviewed fixture/contract identity.
  const rebound = nativeConfigResult();
  rebound.admittedSelection.proof.candidateSha256 = 'a'.repeat(64);
  rebound.admittedSelection.proof.harnessSha256 = 'b'.repeat(64);
  assert.equal(aggregateCases([rebound]).correctContractCases, 1);
});

test('Config defaultdeny and Life denial survive forged or incomplete native context', () => {
  const mutations = [
    r => delete r.admittedSelection,
    r => r.admittedSelection = { kind: 'config-legacy-full-v1', reviewed: true },
    r => r.admittedSelection.proof.reviewed = false,
    r => r.admittedSelection.proof.schema = 'forged',
    r => r.admittedSelection.fixtureFileSha256 = '0'.repeat(64),
    r => r.admittedSelection.proof.fixtureFileSha256 = '0'.repeat(64),
    r => r.admittedSelection.manifestFileSha256 = '0'.repeat(64),
    r => r.admittedSelection.proof.manifestFileSha256 = '0'.repeat(64),
    r => delete r.admittedSelection.manifest.cases[0].expected.body.equals.legacy,
    r => r.admittedSelection.manifest.cases[0].expected.body.equals.legacy.hymn = 'wrong',
    r => r.admittedSelection.manifest.cases[0].expected.headers.etag = 'wrong',
    r => r.admittedSelection.manifest.cases[0].path = '/forged',
    r => r.approvals[0].branch = 'forged reviewed branch',
    r => r.approvals[0].independentContractAccepted = false,
    r => r.admittedSelection.proof.cases[0].independentContractAccepted = false,
    r => r.admittedSelection.manifest.cases.push(structuredClone(r.admittedSelection.manifest.cases[0])),
    r => r.admittedSelection.proof.cases.push(structuredClone(r.admittedSelection.proof.cases[0])),
  ];
  for (const mutate of mutations) {
    const packet = nativeConfigResult(); mutate(packet);
    assert.equal(aggregateCases([packet]).cases.find(c => c.id === 'config-private-content-prefixes').correctnessAccepted, false);
  }
  const oldAlias = nativeConfigResult();
  delete oldAlias.admittedSelection.manifest.cases[0].expected.body.equals.legacy;
  oldAlias.approvals[0].branch = 'Native full legacy contract independently reviewed';
  assert.equal(aggregateCases([oldAlias]).correctContractCases, 0);
  const life = nativeConfigResult();
  life.approvals = [{ id: 'life-feedback-period-timestamp-gap', method: 'GET', path: '/api/v1/life/plan/feedback', independentContractAccepted: true }];
  life.cases = [{ id: 'life-feedback-period-timestamp-gap', accepted: true }];
  assert.equal(aggregateCases([life]).correctContractCases, 0);
});

test('mixed native and old Config occurrences retain AND denial in either order', () => {
  const bound = nativeConfigResult(), old = nativeConfigResult(); delete old.admittedSelection;
  for (const results of [[bound, old], [old, bound]]) {
    const result = aggregateCases(results);
    assert.equal(result.uniqueCases, 1); assert.equal(result.occurrences, 2);
    assert.equal(result.correctContractCases, 0); assert.equal(result.correctnessAccepted, false);
  }
});
