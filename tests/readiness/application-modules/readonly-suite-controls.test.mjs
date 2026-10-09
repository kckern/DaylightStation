import test from 'node:test';
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
