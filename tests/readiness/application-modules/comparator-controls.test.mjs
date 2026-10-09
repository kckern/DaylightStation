import test from 'node:test';
import assert from 'node:assert/strict';
import { compareApi } from './api-comparator.mjs';

const identity = { fixtureSha256: 'a'.repeat(64), sourceCommit: '1'.repeat(40), imageDigest: `sha256:${'2'.repeat(64)}` };
const targets = { isolated: true, reference: { url: 'http://127.0.0.1:43111', ...identity }, candidate: { url: 'http://127.0.0.1:43112', ...identity } };
const manifest = { schema: 'comparator-v1', cases: [{ id: 'ping', method: 'GET', path: '/api/v1/ping', safety: { reviewed: true, disposition: 'read-only', sideEffects: false, nonlocal: false, longLived: false }, expected: { status: 200, headers: { 'content-type': 'application/json' }, body: { kind: 'json', required: { ok: 'boolean', timestamp: 'number' }, equals: { ok: true } } }, normalize: { jsonPaths: ['timestamp'], headers: ['date'] } }] };
const good = (timestamp = 1) => ({ status: 200, headers: { 'content-type': 'application/json', date: 'synthetic' }, body: JSON.stringify({ ok: true, timestamp }) });
const run = (reference, candidate, options = {}) => compareApi({ manifest, targets, transport: async ({ side }) => side === 'reference' ? reference : candidate, ...options });

test('expected outcomes accept selected success without claiming whole-app readiness', async () => {
  const result = await run(good(1), good(2));
  assert.equal(result.accepted, true);
  assert.equal(result.readinessAccepted, false);
});
test('identical server errors cannot satisfy differential equivalence', async () => assert.equal((await run({ ...good(), status: 500 }, { ...good(), status: 500 })).accepted, false));
test('identical empty or schema-invalid bodies fail independently', async () => {
  for (const body of ['', '{}', '{"ok":true,"timestamp":"bad"}', '{"ok":false,"timestamp":1}']) assert.equal((await run({ ...good(), body }, { ...good(), body })).accepted, false);
});
test('required headers and unnormalized body differences remain failures', async () => {
  assert.equal((await run(good(), { ...good(), headers: {} })).accepted, false);
  assert.equal((await run(good(), { ...good(), body: '{"ok":true,"timestamp":1,"extra":true}' })).accepted, false);
});
test('explicit isolated loopback targets and equal fixture hashes are mandatory', async () => {
  for (const changed of [{ ...targets, isolated: false }, { ...targets, candidate: { ...targets.candidate, url: 'https://example.com' } }, { ...targets, candidate: { ...targets.candidate, fixtureSha256: 'b'.repeat(64) } }]) await assert.rejects(run(good(), good(), { targets: changed }));
});
test('non-read-only methods and missing expected outcomes are rejected before transport', async () => {
  for (const changes of [{ method: 'POST' }, { expected: { status: 500 } }, { path: '//example.com' }, { normalize: { jsonPaths: ['ok'], headers: [] } }]) await assert.rejects(run(good(), good(), { manifest: { ...manifest, cases: [{ ...manifest.cases[0], ...changes }] } }));
});
test('transport exceptions fail a case and do not masquerade as responses', async () => assert.equal((await run(good(), good(), { transport: async () => { throw new Error('synthetic unavailable'); } })).accepted, false));
test('unreviewed and effectful GETs reject before any transport call', async () => {
  let calls = 0;
  for (const safety of [undefined, { ...manifest.cases[0].safety, reviewed: false }, { ...manifest.cases[0].safety, sideEffects: true }, { ...manifest.cases[0].safety, nonlocal: true }, { ...manifest.cases[0].safety, longLived: true }]) {
    await assert.rejects(run(good(), good(), { manifest: { ...manifest, cases: [{ ...manifest.cases[0], safety }] }, transport: async () => { calls++; return good(); } }));
  }
  assert.equal(calls, 0);
});
test('same-origin URL variants and unpinned identities reject', async () => {
  for (const candidate of [{ ...targets.candidate, url: `${targets.reference.url}/` }, { ...targets.candidate, sourceCommit: 'main' }, { ...targets.candidate, imageDigest: 'latest' }]) await assert.rejects(run(good(), good(), { targets: { ...targets, candidate } }));
});
test('HEAD requires explicit empty-body semantics', async () => {
  await assert.rejects(run(good(), good(), { manifest: { ...manifest, cases: [{ ...manifest.cases[0], method: 'HEAD' }] } }));
  const head = { ...manifest.cases[0], method: 'HEAD', expected: { status: 200, headers: { 'content-type': 'application/json' }, body: { kind: 'text', exact: '' } }, normalize: { jsonPaths: [], headers: ['date'] } };
  assert.equal((await run({ ...good(), body: '' }, { ...good(), body: '' }, { manifest: { ...manifest, cases: [head] } })).accepted, true);
});

const liveTargets = {
  mode: 'live-reference', readOnlyReference: true,
  reference: { url: targets.reference.url, sourceCommit: '3'.repeat(40) },
  candidate: { url: targets.candidate.url, sourceCommit: '4'.repeat(40), workingTreeSha256: 'b'.repeat(64), fixtureSha256: 'c'.repeat(64), isolated: true },
  dataRelationship: { kind: 'independent-snapshot', description: 'Reviewed local fixtures; data-dependent differences remain failures.' },
};
test('live reference and local candidate need no invented image or equal data identity', async () => {
  const result = await run(good(), good(2), { targets: liveTargets });
  assert.equal(result.accepted, true);
  assert.equal(result.readinessAccepted, false);
  assert.equal(result.mode, 'live-reference');
  assert.equal(result.fixtureSha256, null);
  assert.deepEqual(result.declaredTargets, liveTargets);
});
test('live mode rejects missing isolation, provenance, and data relationship before requests', async () => {
  let calls = 0;
  for (const changed of [
    { ...liveTargets, readOnlyReference: false },
    { ...liveTargets, candidate: { ...liveTargets.candidate, isolated: false } },
    { ...liveTargets, candidate: { ...liveTargets.candidate, workingTreeSha256: undefined } },
    { ...liveTargets, reference: { ...liveTargets.reference, sourceCommit: 'main' } },
    { ...liveTargets, dataRelationship: undefined },
    { ...liveTargets, dataRelationship: { kind: 'matched-snapshot', description: 'Unsubstantiated match' } },
    { ...liveTargets, mode: 'unknown' },
  ]) await assert.rejects(run(good(), good(), { targets: changed, transport: async () => { calls++; return good(); } }));
  assert.equal(calls, 0);
});
test('live mode preserves method and side-effect denial before requests', async () => {
  let calls = 0;
  for (const change of [{ method: 'POST' }, { safety: { ...manifest.cases[0].safety, sideEffects: true } }]) {
    await assert.rejects(run(good(), good(), { targets: liveTargets, manifest: { ...manifest, cases: [{ ...manifest.cases[0], ...change }] }, transport: async () => { calls++; return good(); } }));
  }
  assert.equal(calls, 0);
});

test('array-root contracts preserve exact populated values and order', async () => {
  const selected = { ...manifest, cases: [{ ...manifest.cases[0], expected: { ...manifest.cases[0].expected, body: { kind: 'json-array', exact: [{ id: 'learner-a' }, { id: 'learner-b' }] } }, normalize: { jsonPaths: [], headers: ['date'] } }] };
  const response = body => ({ ...good(), body: JSON.stringify(body) });
  const expected = selected.cases[0].expected.body.exact;
  assert.equal((await run(response(expected), response(expected), { manifest: selected })).accepted, true);
  for (const body of [[], {}, [...expected].reverse(), [...expected, { id: 'extra' }]]) {
    assert.equal((await run(response(body), response(body), { manifest: selected })).accepted, false);
  }
  await assert.rejects(run(response(expected), response(expected), { manifest: { ...selected, cases: [{ ...selected.cases[0], normalize: { jsonPaths: ['0'], headers: [] } }] } }));
});
